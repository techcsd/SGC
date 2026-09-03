# BG1/BG3 — Outbox: la TERCERA categoría de error + rescate sin pérdida (contrato servidor ↔ app)

> Amplía [`BC3-outbox-validacion-contrato.md`](./BC3-outbox-validacion-contrato.md). Nace de las bitácoras REALES de un ingeniero atascadas desde el 20 y 25-ago por "new row violates row-level security policy": el diseño anterior ofrecía **"Descartar"** como salida principal de un error que **no es culpa del usuario**. Regla que esta tanda consagra: **la data real de obra NUNCA se pierde.**
>
> Este doc es el contrato para PROMPT-29 (app). El lado servidor (web/BD) ya está construido: ver §5.

## 1. TRES categorías (antes eran dos)

La app clasifica cada fallo del outbox por el **código** del error (no por el texto):

| Categoría | Señal (SQLSTATE / red) | Culpa | Manejo en el outbox |
|-----------|------------------------|-------|---------------------|
| **Transitorio** | red (`Failed to fetch`, timeout), `5xx`, `40001`, `57014` | de nadie (temporal) | **Auto-retry con backoff**, tope 5/24h; luego "necesita acción". |
| **Error de dato** | `22023` (error_campo), `22P02`, `23502`, `23503`, `23505`, `22001` string-too-long | del **dato** del usuario | **NO** auto-retry. **"Corregir"** (abre el registro con el `campo` marcado). |
| **Error del sistema** 🆕 | `42501` RLS, `23514` check, `PGRST2xx`, y todo bug del server que no es dato ni red | del **sistema** (mal configurado) | **Conservar INDEFINIDAMENTE**; reintento manual siempre disponible; **"Descartar" escondido** tras doble confirmación con aviso de pérdida. Se **reporta a Tecnología** (§5). |

> **El texto importa.** Para 'sistema' el mensaje **no culpa al usuario**: *"Esto es un problema del sistema — ya quedó reportado a Tecnología. Podrás reintentarlo cuando se publique la corrección."* El mensaje actual "No tienes permiso para enviar esto. Contacta a un administrador" es **incorrecto** para este caso: el ingeniero SÍ tiene permiso de negocio.

### Mapa código → categoría (una sola fuente)
La app mantiene el mapa en un solo lugar. Regla de desempate cuando un código cae en dos:
- `42501` → **sistema** (RLS mal configurada), NO "sin permiso del usuario" — porque el permiso de negocio existe; lo que falla es la política.
- `23514` / `22001` → hoy salen de un constraint/columna desactualizada del server (sistema). Si en el futuro un check valida un dato legítimo del usuario, ese caso concreto se emite con `error_campo` (22023 → dato). Regla: **si el server puede decir "esto lo arreglo yo", es sistema; si dice "corrige tu dato", es dato** — y lo señala con `error_campo`.

## 2. Semántica de la categoría 'sistema'

1. **Se conserva indefinidamente** — nunca expira ni se auto-descarta. "Descartar" queda escondido tras doble confirmación con aviso explícito de pérdida de fotos/trabajo.
2. **Reintento manual siempre disponible.**
3. **Reintento post-fix idempotente** (§4): reenvía el payload original íntegro (fotos incluidas) sin duplicar.
4. **Reporte a Tecnología** (§5): al entrar por primera vez en 'sistema', la app llama `reportar_outbox_atascado`.

## 3. Ver el contenido + duplicar (BG3)

- Tap en la tarjeta del pendiente → **vista de solo-lectura** de TODO el contenido (campos, actividades/renglones, comentarios y **fotos** — están en el dispositivo).
- **"Duplicar a nueva bitácora"**: borrador nuevo pre-llenado (fotos incluidas), sin re-teclear.
- **Compartir/exportar** (texto + fotos) como último recurso (WhatsApp).
- Aplica a **todos** los tipos del outbox: bitácoras, echadas, confirmaciones, conduces, conduce externo, fichas de personal.

## 4. Idempotencia del reenvío (BG1(b)) — estado por RPC (verificado en prod 01/09/2026)

Un reintento tras un fix NO debe duplicar el registro si un intento anterior escribió a medias.

| RPC de envío | Clave de idempotencia | Estado |
|--------------|-----------------------|--------|
| `crear_bitacora_app` | `p_id` (uuid del cliente) — `if exists(...) return p_id` | ✅ idempotente |
| `registrar_combustible_app` | `p_client_uuid` — dedup por client_uuid | ✅ idempotente |
| `confirmar_recepcion_salida` | guarda por estado (`estado <> 'despachado'` → "ya tiene recepción confirmada") | ✅ no duplica. **La app debe tratar "ya tiene una recepción confirmada" como ÉXITO** (el primer intento sí escribió; se perdió el ack). |
| `crear_conduce_externo` | **ninguna** | ⚠️ **GAP** — un reintento duplicaría el conduce. **Follow-up PROMPT-29:** añadir `p_client_uuid` (uuid del cliente) + guarda `if exists`. Server lo acepta cuando la app lo pase. |
| fichas de personal / otros | — | Revisar al migrarlos al outbox; **todo send op nuevo nace con clave de idempotencia del cliente** (regla). |

**Regla de contrato:** todo endpoint de envío del outbox **acepta una clave de idempotencia generada por el cliente** (uuid) y, ante un reenvío con la misma clave, **devuelve el registro existente en vez de crear otro**.

## 5. Señal "corregido" + telemetría (lado servidor — CONSTRUIDO)

- **Telemetría (BG2):** `sgc.reportar_outbox_atascado(dedup_key, tipo_op, categoria, error_kind, error_code, error_msg, intentos, fotos_count, edad_horas, payload_resumen)` — la app lo llama cuando un item entra/permanece en 'sistema'. DEFINER (estampa identidad; no depende de permisos). Idempotente por `(usuario, dedup_key)`. Alerta a Tecnología la primera vez (Matriz BF4, tipo `outbox_atascado`) + resumen diario si persisten. Panel `/tecnologia/outbox-atascados`.
- **Señal "corregido" (BG1c):** `sgc.publicar_fix_outbox(descripcion, tipo_op?, error_code?, min_app_version?)` (Tecnología, al deployar el fix) y `sgc.outbox_fixes_activos()` (la app consulta).
  - ⚠️ **Decisión Xaviel (PROMPT-29):** ¿el reintento post-fix es **sugerido** al usuario o **automático** (una vez por versión)? El contrato sirve a ambos.
- **🆕 Matching sin `error_code` (BI2, PROMPT-32):** `sgc.outbox_fix_para(p_tipo_op, p_error_code?, p_app_version?)` es la **única fuente de verdad** del matching (AU1). La regla:
  - **tipo_op:** el fix aplica si `fix.tipo_op` es null o coincide.
  - **versión:** aplica si `fix.min_app_version` es null o `app_version >= min` (por `sgc.semver_code`).
  - **error_code:** **filtro OPCIONAL** — sólo estrecha cuando el **item** trae `error_code` no vacío; si el item no lo trae, no bloquea.
  - **Por qué:** el `error_code` de los registros atascados está **vacío y siempre lo estará** (el campo nació en la app 2.10.0; los registros son de agosto; y `StorageApiError` no trae `code`). El viejo `(it.error_code ?? '').startsWith(f.error_code)` hacía la señal **estructuralmente inalcanzable**. La app (PROMPT-33) **debe** llamar a `outbox_fix_para` en vez de comparar `error_code` en el cliente.

## 6. Rescate de las 3 bitácoras del ingeniero

⚠️ **Corregido en BI1 (03-sep):** la causa real NO era una política de INSERT por rol —
`crear_bitacora_app` es DEFINER y siempre pasó. Era que el bucket `sgc-bitacora` no tenía
política **UPDATE**, y la app sube las fotos con `upsert:true`: el reintento (re-upload de la
misma ruta) moría en Storage con RLS. Cerrado por `sql/2026-09-03-bi1-bitacora-storage-update.sql`
+ auditor `audit-buckets-upsert-policy.mjs` (prebuild) + smoke que **reintenta**.

Estado del rescate (usuario real = **Jonathan Roman**): sus fotos **ya están en Storage**
(folders huérfanos `63fa7138…`/6, `bda603c7…`/2, `1a35f057…`/10 — subidas en el 1er intento).
Con BI1 aplicado, el reintento desde su teléfono re-sube (UPDATE, ahora permitido) y
`crear_bitacora_app` graba. **Verificar con él que las 3 llegaron completas y se ven en la
web.** Bloqueos de UI para que el botón de reintento aparezca = app, PROMPT-33 (BI2).
