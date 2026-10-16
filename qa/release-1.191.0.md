# Release 1.191.0 — Ronda CP (PROMPT-100)

- **Equipo/tester:** Claude Code (sesión autónoma), verificación técnica contra dev
  (`fzfrnrvndzrjwyvdpkgg`). **Falta la prueba manual de Xaviel en
  `dev.sgcconstructorasd.com`** antes del OK final a `main`.
- **Qué se probó (automatizado, contra dev):**
  - `npm run build` completo (20 guards de prebuild + `ng build`) — verde.
  - `npm run test:unit` — 38/38 verdes.
  - CP11.1 (RLS aprobador de compras): smoke con el usuario real de Eduardo Ng en
    dev — ve sus 2 solicitudes tras el fix (antes, 0).
  - CP7 (vistas security_invoker): smoke con un usuario admin/flota (sigue viendo
    todo) y un usuario sin ese rol (antes veía todo saltándose RLS, ahora ve 0 filas).
  - CP6 (`requisiciones_por_despachar`): verificado que devuelve `codigo`,
    `urgencia`, `fecha_necesidad` y el orden `asc` (más viejas primero).
  - CP2 (compartir + admin Compa): smoke completo — compartir, ver "compartidas
    conmigo", tercero correctamente rechazado, admin lista/detalle, auditoría
    (`assistant_acciones` tool `admin_vio_conversacion`) registrada, no-admin
    rechazado en las RPCs de admin.
  - CP8 (Reuniones): smoke completo — crear reunión (agenda heredada del tipo),
    nota propia, acuerdo → tarea, acta borrador → aprobar (crea la tarea), usuario
    sin el módulo correctamente rechazado.
  - **Evals de Compa:** `node scripts/compa-evals.mjs --env dev` → **12/12 OK**
    (incluye el caso real de Hector — ya no dice "no tengo herramienta" teniendo
    `listar_almacenes` — y el nuevo caso de `mis_reuniones`). Reporte:
    `qa/compa-evals-dev.json`.
- **Versión de origen:** 1.190.1 (prod).
- **Resultado:** OK técnico (automatizado). Pendiente: prueba manual de Xaviel en
  dev.sgcconstructorasd.com de las pantallas nuevas (Reuniones, Personal de obra,
  Compartir en Compa, Sistema › Conversaciones de Compa) antes de promover a `main`.
- **Fecha:** 2026-10-16.

## Lo que NO se promueve a prod todavía (fuera de este release de la web)
- **Edge `assistant` con las mejoras CP3/CP9** (modelo Sonnet, varios archivos,
  validador de promesas, rechazo de gaps falsos, 3 tools nuevos de Reuniones) —
  está en **dev v19**, evals verdes (12/12, dos corridas seguidas), pero el
  prompt original pide explícitamente "Prod con OK" para este cambio por el peso
  que tiene (modelo nuevo, costo, comportamiento). Pendiente de que Xaviel la
  pruebe en dev y dé el visto bueno para `deploy-edge.mjs --env prod`.
- **Fireflies / Google Calendar**: el módulo Reuniones funciona sin estas piezas
  (ver `docs/REUNIONES.md`). Los edges `reuniones-calendar` y `fireflies-webhook`
  **sí existen y están desplegados en dev** (v2 cada uno) — probados en modo
  degradado (sin secretos configurados): `reuniones-calendar` responde
  `{conectado:false}` con el mensaje de "copia la invitación"; `fireflies-webhook`
  responde 503. Para activarlos de verdad falta que Xaviel cree
  `minutas@constructorasd.com`, el asiento Fireflies Pro, la API key/webhook, y el
  scope `calendar.events` en Google Admin (lista completa en `docs/REUNIONES.md`).
  No se han desplegado a prod (sin secretos ahí tampoco tendrían efecto, pero se
  despliegan junto con el resto cuando Xaviel dé el OK de esta versión).
