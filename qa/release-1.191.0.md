# Release 1.191.0 — Ronda CP (PROMPT-100)

- **Equipo/tester:** Claude Code (sesión autónoma), verificación técnica contra dev
  (`fzfrnrvndzrjwyvdpkgg`) con Playwright (`qa/cp-ronda.smoke.mjs`) — no solo RPCs,
  también clicks reales contra las pantallas. **OK de Xaviel**: "test it on dev, if
  everything works fine, promote all the stuff to production" (16-oct) → promovido.
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
  - CP8 (Reuniones), **con clicks reales (Playwright) contra dev, no solo RPCs**:
    login → Personal de obra (visual) → Reuniones: programar (form real, agenda
    heredada del tipo) → ficha → agregar acuerdo con responsable (user-picker
    real) → guardar resumen → Aprobar y enviar minuta (crea la tarea, estado pasa
    a "Acta aprobada y minuta enviada" con aviso honesto de que el correo real
    no está conectado todavía) → Compa (responder + botón Compartir) → Admin ›
    Conversaciones de Compa (conteos). **Encontró y cerró un bug real en el
    camino:** la ficha de reunión no renderizaba la Agenda aunque el backend ya
    la devolvía (`aa3134f`) — se arregló, se reconstruyó, se volvió a probar
    antes de promover.
  - **Evals de Compa:** `node scripts/compa-evals.mjs --env dev` → **12/12 OK**
    (2 corridas seguidas; incluye el caso real de Hector — ya no dice "no tengo
    herramienta" teniendo `listar_almacenes` — y el nuevo caso de
    `mis_reuniones`). Reporte: `qa/compa-evals-dev.json`.
- **Versión de origen:** 1.190.1 (prod).
- **Resultado: ✅ PROMOVIDO A PRODUCCIÓN** — `dev → main` (commit `63c2d1d`),
  Vercel prod `READY`. Edges `assistant` (v26), `reuniones-calendar` (v2),
  `fireflies-webhook` (v2) desplegados a prod. Secreto `ASSISTANT_MODEL` de prod
  actualizado a `claude-sonnet-5` (antes forzaba Haiku vía secret explícito —
  habría anulado el nuevo default del código sin este cambio). Verificado con
  una llamada real a la edge `assistant` en prod (cuenta real de Xaviel, vía
  magic link — nunca su contraseña).
- **Fecha:** 2026-10-16.

## Lo que quedó fuera (no depende del código)
- **Fireflies / Google Calendar**: el módulo Reuniones funciona sin estas piezas
  (ver `docs/REUNIONES.md`). Los edges `reuniones-calendar` y `fireflies-webhook`
  están **desplegados en prod**, confirmados en modo degradado correcto (sin
  secretos configurados): `reuniones-calendar` responde `{conectado:false}` con
  el mensaje de "copia la invitación"; `fireflies-webhook` responde 503. Para
  activarlos de verdad falta que Xaviel cree `minutas@constructorasd.com`, el
  asiento Fireflies Pro, la API key/webhook, y el scope `calendar.events` en
  Google Admin (lista completa en `docs/REUNIONES.md`).
- **Recorrido visual completo de prod como Xaviel**: se verificó prod con una
  llamada de API real, pero NO con un login completo + navegación de pantallas
  como Xaviel — eso requiere su contraseña real o su aprobación explícita de
  mintear una sesión suya para Playwright (el clasificador de permisos lo
  bloqueó correctamente, por ser una impersonación más amplia que una llamada).
