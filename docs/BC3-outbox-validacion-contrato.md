# BC3 — Contrato de validación del outbox (servidor ↔ app)

> Objetivo: que un registro que el servidor va a rechazar **nunca entre al outbox**, y que cuando un error ocurra, la app sepa **qué campo** falló y **si debe reintentar solo o pedir corregir**. Cierra el caso del "Enlace de tarea · Hay un dato con formato inválido" atascado 15 h.

## 1. Forma del error tipado de validación (servidor)

Toda validación de campo en el servidor se lanza con la primitiva `sgc.error_campo(campo, motivo, mensaje)`, que produce:

| Postgres        | PostgREST (JSON)        | Uso en la app |
|-----------------|-------------------------|---------------|
| `errcode 22023` | `code: "22023"`         | **Error de validación** → NO auto-retry; pedir corregir |
| `MESSAGE`       | `message` (español)     | Texto para el usuario |
| `DETAIL` (JSON) | `details: "{\"campo\":…,\"motivo\":…}"` | Campo a marcar en el formulario |
| `HINT`          | `hint: "<campo>"`       | Atajo al nombre del campo |

Ejemplo real (`enlazar_bitacora_tarea`):
```json
{ "code": "22023",
  "message": "La bitácora enlazada todavía no está guardada. Envía primero la bitácora y reintenta el enlace.",
  "details": "{\"campo\":\"bitacora_id\",\"motivo\":\"no_existe\"}",
  "hint": "bitacora_id" }
```

`motivo` es un enum estable: `requerido · formato_invalido · no_existe · fuera_de_rango · duplicado · requerida_para_completar`.

## 2. Clasificación: transitorio vs validación (política de reintentos)

La app decide el manejo por el **código** del error, no por el texto:

| Clase | Señal (code / red) | Manejo en el outbox |
|-------|--------------------|---------------------|
| **Validación** | `22023` (error_campo), `22P02` (formato en el borde), `23502` not-null, `23514` check, `23503` FK, `23505` unique | **NO** auto-retry. Marcar la tarjeta como "necesita corrección", abrir el registro con el `campo` señalado. Descartar = último recurso. |
| **Transitorio** | red (`Failed to fetch`, timeout), `5xx`, `40001` serialization, `57014` statement timeout | **Auto-retry con backoff** (p. ej. 1m, 5m, 15m, 1h), tope **5 intentos / 24 h**; luego pasa a "necesita acción". |
| **Auth** | `42501` permiso, `401/403`, JWT vencido | Renovar sesión y reintentar una vez; si persiste, "sin permiso". |

> El bug original: `22P02` (uuid vacío en el borde de PostgREST) se trataba como genérico y sin campo → "dato con formato inválido" eterno. Ahora el servidor valida **dentro** con `error_campo` y devuelve el campo; y `22P02` está clasificado como validación (no se reintenta solo).

## 3. Validar ANTES de encolar (cliente)

Reglas espejo que la app debe correr antes de meter la op al outbox (evita el viaje de ida y vuelta):

| Operación (RPC) | Campo | Regla cliente |
|-----------------|-------|---------------|
| Enlace de tarea (`enlazar_bitacora_tarea`) | `tarea_id`, `bitacora_id` | uuid válido y no vacío; `bitacora_id` debe apuntar a una bitácora **ya sincronizada** (si la bitácora sigue en el outbox, encolar el enlace **después**, encadenado). Si `completar` → `foto_path` presente. |
| Bitácora (`crear_bitacora_app`) | `proyecto_id`, `fecha`, `tipo`, fotos | uuid; fecha ISO `YYYY-MM-DD`; `parte_diario` ≥2 fotos, `incidente` ≥1. |
| Echada de combustible (`registrar_combustible_app`) | `litros`, `monto`, `odometro` | numérico con **punto** decimal (no coma — familia AW3); dentro de banda/tope de tanque. |
| Confirmación de recepción (`confirmar_recepcion_salida`) | `salida_id`/`conduce_id` | uuid; foto/firma si el tipo la exige. |
| Conduce (`crear_conduce`) | `origen_id`, `destino_id` | uuid; `origen ≠ destino`. |

**Dependencias entre ops**: cuando una op referencia el id de otra que aún no sincronizó (bitácora→enlace, conduce→confirmación), la app **encadena** (no encola la dependiente hasta que la principal confirme su id de servidor), o reintenta la dependiente sólo tras el ack de la principal.

## 4. Recuperación sin pérdida (tarjeta del outbox)

La tarjeta de una op fallida por **validación** ofrece, en este orden: **Corregir** (abre el registro editable con el `campo` marcado) › Reintentar › Descartar (último recurso, avisa que pierde foto/trabajo). El "detalle técnico" muestra el `message` humano + `campo`, nunca el error crudo de Postgres.

## 5. Estado en el servidor (hecho)

- `sgc.error_campo(campo, motivo, mensaje)` — primitiva de error tipado (22023 + detail JSON).
- `sgc.es_uuid(text)` — validación de formato sin lanzar.
- `sgc.enlazar_bitacora_tarea(text, text, boolean, text)` — ids como TEXT, valida requerido→formato→existe con campo señalado (antes reventaba en el borde con `22P02`).

**Follow-up (adopción gradual):** migrar `crear_bitacora_app`, `registrar_combustible_app`, `confirmar_recepcion_salida`, `crear_conduce` a `error_campo` para uniformar el `{campo, motivo}` en todo el outbox. La clasificación de §2 ya funciona hoy porque se basa en los `errcode` estándar de Postgres.
