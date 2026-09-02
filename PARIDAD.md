# PARIDAD web ↔ app (X13) — documento vivo

Regla madre: **la web (SGC) es el padre**. No puede haber captura de datos que se
haga en la app móvil (`csd-app`) y en la web no. No se busca clonar la UI de la
app, sino **coherencia funcional y de datos** (mismos campos, validaciones y orden
lógico de captura; el layout puede diferir).

> **Ronda BF (01/09/2026):** cerradas 4 capacidades nuevas (personal de obra con
> documentos/contratos, requisición corregible, proveedor con tipos, preferencias
> de avisos) — ver filas 4a–4d y "Decisiones (Ronda BF)".
>
> Estado: iniciado en Ronda 9 (23/07/2026). La auditoría dirigida encontró que
> **el esquema de BD ya soporta casi todo** (ambos RPCs de bitácora escriben una
> fila `bitacora_actividades` por actividad, cada una con su `bloque`). Los gaps
> están en la **capa de formulario/UX de la web** y en la **infraestructura de
> borradores/offline**, no en el esquema.

## Leyenda de clasificación
- **rápido** — cambio pequeño y localizado.
- **mediano** — nueva sección/formulario contra RPC/esquema existentes.
- **requiere decisión** — hay que decidir arquitectura/UX antes de construir.

## Matriz de capacidades (foco: captura de datos)

| # | Capacidad | App | Web | Gap | Clase | Estado |
|---|---|---|---|---|---|---|
| 1a | Múltiples bloques/sujetos en un parte de bitácora | Sí (loop sujeto→actividades) | **Sí (Ronda 9)** — actividades por `(bloque·estructura·actividad)`, repetibles por bloque | — | requiere decisión | **✅ cerrado R9** |
| 1b | `bloque_entrepiso` de cabecera opcional | Opcional (derivado) | **Opcional (Ronda 9)** | — | rápido | **✅ cerrado R9** |
| 1c | Snapshot de clima automático en el parte | No | Sí | — (web adelante) | — | n/a |
| 1d | Set de campos (personal/restricciones/equipos/clima/mín. fotos) | Completo | Completo | No | — | ok |
| 2a | Borradores multi-instancia persistentes | IndexedDB (Dexie) + fotos | **localStorage multi-borrador (Ronda 9, bitácora)** | Parcial | requiere decisión | **🟡 parcial R9** |
| 2b | Autosave en `visibilitychange`/`pagehide` | Sí | valueChanges + `pagehide` (bitácora) | Parcial | mediano | 🟡 parcial R9 |
| 2c | Hub "Documentación en proceso" (borradores + outbox) | Sí | Sección "En proceso" en bitácora | Parcial | mediano | 🟡 parcial R9 |
| 2d | Retomar-incompleto en forms no-bitácora | 14 forms | No | Sí | mediano | backlog |
| 3a | Captura de checklist pre-uso | Sí (offline) | Solo visor/registro (Ronda 6 paridad) | Parcial | mediano | backlog |
| 3b | Captura de combustible | Sí | Dashboards + registro web | Parcial | mediano | backlog |
| 3c | Entrega/recepción de vehículo | Sí | **Sí (W3/Ronda 8 `registrar-entrega`)** | — | — | ok |
| 3d | Captura de multa | Sí | **Sí (T12 + detalle W5)** | — | — | ok |
| 3e | Accidente/daño de vehículo | Sí | **Sí + fotos del hecho (X3/Ronda 9)** | — | — | ok |
| 3f | Reporte de mantenimiento | Sí | **Sí (con tipos X6/Ronda 9)** | — | — | ok |
| 3g | Conteo de inventario con stock en vivo | Sí (diff, offline) | **Solo lista, sin form de conteo** | Sí | mediano | backlog |
| 3h | Entrada/salida de inventario multi-línea | Sí (offline, drafted) | Vistas admin + registro | Parcial | mediano | backlog |
| 3i | Captura offline-first (outbox) | Sí, todos los flujos | No (RPC online) | Sí | requiere decisión | backlog (fuera de alcance web) |
| 4a | Personal de obra: registrar + expediente (datos, carnet/QR, fotos, **documentos y contratos firmados**) | Sí (wizard AZ + visor PDF de contratos, BF8/FASE 4) | **Sí (BF8)** — mismo hogar Proyectos › Personal; RRHH gana el submódulo `proyectos.personal` | — | mediano | **✅ cerrado BF** |
| 4b | Requisición corregible tras creada (obra/ubicación editable + rechazada → corregir → **reenviar** v2 con historial) | **Sí (BF6)** — obra editable, motivo del rechazo visible, diff en historial | **Sí (BF6)** | — | mediano | **✅ cerrado BF** |
| 4c | Proveedor con **tipos** (ferretería/suministros/transportista/otro) + alta al vuelo | Sí (transportista desde conduce externo, estampado server-side) | **Sí (BF2)** — maestro unificado `sgc.proveedores` con `tipos[]` | — | requiere decisión | **✅ cerrado BF** |
| 4d | Preferencias de avisos por usuario (silenciar informativos; operativos no) | Sí (Perfil → Preferencias de avisos; silencia el **push** server-side, BF4) | **Sí (BF4)** — silenciado por usuario + reglas de admin por rol/global | — | rápido | **✅ cerrado BF** |

## Árbol de Ingeniería (BH2 — 02/09/2026)

| # | Capacidad | App | Web | Gap | Clase | Estado |
|---|---|---|---|---|---|---|
| BH2 | **Árbol de Ingeniería** (menú del módulo) | **1 tile** (Solicitud de movimiento) + capacidad dispersa en hubs sueltos (`/bitacora`, `/obra`, `/solicitudes`, `/transporte/por-confirmar`) | **13 hijos** bajo el grupo paraguas del sidebar (`shell.ts`) | **Organización, no capacidad** — la app tiene casi todo, en hubs separados. 2 huecos reales: **Dashboard de bitácora** y **Mi proyecto** no existen en la app | requiere decisión (cerrada) | **✅ decidido BH2** — árbol canónico aprobado (ver `docs/AV5-AV6-…` §AV6 CERRADO). Ejecución app = **traslado puro con mock-first** en **PROMPT-31**; web ya es canónica |

Árbol canónico (capacidades, web=app): `Requisición · Solicitud de movimiento · Confirmar entregas · Bitácora (suite) · Producción de obra (Plan del día · Avance · No conformidades · Checklists · Subcontratistas) · Informe semanal de obra · Mi proyecto · Dashboard de bitácora`. **"Crear ruta"** vive en Flota (no en Ingeniería). El **traslado** de los tiles de uso diario del home de la app al hub va **con mock validado primero** (lección BD1).

## Decisiones de arquitectura (Ronda BF — 01/09/2026)

- **Selector de obras POR CONTEXTO (BF7):** `directorio_proyectos(p_contexto)` es **WIDE** por defecto (conduce/ruta/personal/despacho → todas las obras activas para todos, incluido el chofer) y `proyectos_pickables()` es **SCOPED** (requisición/compra/bitácora → el ingeniero ve las suyas + red AW1). Arregla el "chofer no ve obras" sin barrer al ingeniero.
- **Proveedores unificados (BF2):** un solo maestro `sgc.proveedores` con `tipos text[]` (ferreteria/suministros/transportista/otro, multiselección); `is_hardware_store` queda sincronizado con `'ferreteria'`. El alta al vuelo del conduce externo nace `transportista`.
- **Requisición corregible (BF6):** `motivo_rechazo` es columna propia (deja de pisar `notas`); `editar_requisicion` pasa a 5-arg (`+p_proyecto_id`, editable en `pendiente` **y** `rechazada`; una rechazada vuelve a `pendiente` v2 con el diff en el historial que el aprobador ve antes de aprobar).
- **Avisos (BF4):** `send_push` respeta `notif_pref_usuario` (silencio del usuario) **y** `notif_regla` (reglas de admin por rol/global) a nivel de servidor; cada envío deja traza en `notif_entregas` (enviada/entregada/fallida/omitida + motivo), visible en Administración.

## Decisiones de arquitectura (Ronda 9)

- **Multi-bloque bitácora (1a):** se re-modeló la captura de actividades de la web
  de un mapa `estructura|actividad` a un **arreglo de renglones** con clave
  `(bloque · estructura · actividad)` — la misma actividad puede registrarse en dos
  bloques en el mismo parte. `bloque_entrepiso` de cabecera pasó a **opcional** y
  actúa solo como default. El RPC (`crear_entrada_bitacora`) y el esquema **no
  cambiaron** (ya guardaban `bloque` por actividad).
- **Borradores web (2):** en vez de replicar el IndexedDB+Dexie de la app (pesado
  para el back-office), la web usa **localStorage multi-borrador** (clave por
  instancia) con autosave (`valueChanges` + `pagehide`) y una lista "En proceso"
  para retomar/descartar. No persiste archivos (limitación aceptada: el back-office
  suele completar el parte en una sesión). El hub global de en-proceso y el
  retomar en otros forms quedan en backlog.

## Backlog (priorizar en próximas rondas)
- 2d — retomar-incompleto en forms largos no-bitácora (flota, inventario).
- 3a/3b/3g/3h — formularios de captura web para pre-uso, combustible y **conteo de
  inventario con stock en vivo** (hoy la web solo lista los conteos).
- 3i — captura offline-first en la web (requiere decisión; el back-office suele
  tener conexión, así que baja prioridad).
