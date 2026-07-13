# SGC — Session Handoff

_Last updated: 2026-07-12_

## Current focus: Reunión 07/07/2026 — Parte A (A1–A9)

Big multi-phase build from the 07/07/2026 meeting. Source of truth:
`C:\Users\xavie\Desktop\X Dev\Constructora SD\SGC meet improvements\07072026 meet.md`
(+ `...- Claude Code prompt.md`, CSD-OPE-01 docx, kit xlsx, org pptx).
Branch: **`feat/meet-07072026`**. Prod DB is **shared with the CSD mobile app** —
everything must stay retro-compatible (mobile RPCs: `crear_solicitud_app`,
`crear_entrega_vehiculo`, `registrar_*_app`, `recibir_conduce_app`, `registrar_conteo_app`).

### Locked decisions (Xavier, 2026-07-12)
1. **Requisición** = repurpose `sgc.solicitudes_material`; on approval auto-split
   (in-stock → despacho/conduce, shortfall + non-catalog → auto `solicitudes_compra`).
   No new table. `solicitudes_compra` = purchase side owned by Compras.
2. **Approver** stays permission-based (`inventario`/`compras` module holders).
3. **Antifraud alerts** (A4) silent to obra; panel in Dirección; notify roles
   Dirección General + Gerencia + Administrador.
4. Execute autonomously phase-by-phase, commit+verify each, checkpoint at forks.

### ✅ Done — A1 + A2 (commit `1e5efc1`, build passing, migration live on prod)
- **A1 renames (UI-only, DB/routes/embeds untouched):** "Bodega"→"Almacén"
  across Inventario/conduces/salidas/entradas/reportes/dashboard/dudas/auditoría/nav;
  "Solicitud de material"→"Requisición" (engineer page, nav, badges, Dirección, auditoría).
- **A2 unified flow:** `sql/2026-07-12-requisiciones-flujo.sql` applied →
  - RPC `sgc.aprobar_requisicion(p_solicitud_id, p_bodega_id, p_fecha, p_responsable, p_observaciones, p_items)`
    `SECURITY DEFINER`, returns `{salida_id, solicitud_compra_id, despachado_total, faltante_total}`.
    Splits: dispatchable = `min(req, stock@bodega)` → `registrar_salida_inventario`; rest → auto `solicitudes_compra` (pendiente) linked via `origen_requisicion_id`.
  - New cols: `solicitudes_material.{solicitud_compra_id,bodega_id}`, `solicitudes_compra.origen_requisicion_id`.
  - Old `aprobar_solicitud_material` kept (deprecated). Estados stay in app-known set.
  - Approval UI (`inventario/salidas`): approver **maps each free-text requisición line to a catalog article** (auto-matched by name/code); unmapped → purchase. Shows split summary toast.
  - Realtime added for `solicitudes_material/compra` + `salidas_inventario` (live badges).
  - **Fork flagged:** removed "Solicitar compra" from the engineer's Bitácora nav
    (route still exists). Non-catalog needs now flow through the requisición as
    free-text → auto-compra. Confirm with Xavier if he wants it back.

### 🔜 Needs Xavier QA before extending (A3/A4 hook into aprobar_requisicion)
End-to-end click-through (his manual QA workflow):
1. Engineer → Bitácora → Requisición → nueva requisición (free-text items).
2. Almacén → Inventario → Salidas → "Requisiciones pendientes" → Aprobar →
   pick almacén, confirm article mapping → "Aprobar y despachar".
3. Verify: a conduce (salida) exists for the in-stock part **and** a new
   Solicitud de compra appears in Compras → Órdenes for the shortfall.

### ✅ Done — A6 + A7 (commit `9205f69`, build passing, migrations live on prod)
- **A6 Flota checklists:** `sql/2026-07-12-flota-checklists.sql` (+ `-seed.sql`) →
  `checklist_plantillas`/`_items`, `checklists_vehiculo` (+`_respuestas`/`_fotos`),
  RLS + grants; RPC `registrar_checklist_vehiculo` (SECURITY DEFINER, idempotent by
  client UUID → CSD-App-ready) + `atender_checklist_vehiculo`. Seeded 3 templates
  (Pre-Uso Liviano 8, Inspección Seguridad 19, Pre-Uso Camión 12) by categoría
  liviano/camión/equipo. Critical NO → realtime toast to Flota + `flota` badge until atended.
  Page `/flota/checklists` (fill OK/NO/NA, per-tipo template auto-suggest, history, atender), route+nav.
- **A7 Tecnología module:** permission `tecnologia` (roles.service + admin array_append),
  parent route ungated (guide for all) + gated children, nav+icon, dashboard card.
  Tables: `tec_herramientas` (seeded Drive/Claude/Fireflies/Meet), `tec_matriz`,
  `tec_equipos` + `tec_equipo_historial` (dedicated tech inventory → empleado + history;
  architect choice: NOT activos_fijos, to keep asset-accounting register clean).
  Compras tec: `solicitudes_compra.proyecto_id` nullable + `categoria`; RPC
  `crear_solicitud_compra_tec` → flows to Compras/Gerencia. 5 pages (guia/homologacion/matriz/inventario/compras).
- Dudas FAQ updated (Tecnología, flota checklists, requisición flow). Dashboard card added.

### ✅ Done — A3.2 Equipo de Obra (commit `997e9b2`, build passing, migration live)
- `sql/2026-07-12-equipo-obra.sql`: `proyecto_empleados` empleado_id nullable +
  externo_nombre/tipo, desde/hasta, activo, notas + CHECK (empleado OR externo).
- Model `ROLES_OBRA` (authoritative CSD-OPE-01 §5 catalog) + `ROLES_GERENCIA_OBRA`
  (2 mgmt roles, informational) + `rolObraLabel()`. Service `addMiembro`.
- UI: Proyectos > detalle → "Equipo de Obra" (rol catalog, empleado/externo toggle, vigencia).
- **Deferred (note):** (a) mgmt roles gerente_produccion/ing_supervisor_general have a
  catalog but no company-level assignment UI yet; (b) "only assigned Residente/Responsable
  can requisition" validation NOT enforced in the shared RPC (do it when extending A2/A4).
  Guarda-Almacén role value `guarda_almacen` is queryable for A5.

### ✅ Done — A8 Expediente de inicio de obra (commit `a1cf7b2`, build passing, migration live)
- `sql/2026-07-12-expediente-obra.sql`: `expediente_obra` (checklist por doc/proyecto,
  estado pendiente/cargado/validado/no_aplica), RLS (proyectos/legal/admin) + grants,
  RPC `sembrar_expediente_obra` (11 docs §6.1.1, idempotent), view
  `v_expediente_obra_resumen` (security_invoker) for KPI.
- Component `<app-expediente-obra>` in Proyectos detail (init, per-doc estado/responsable/
  file upload to `sgc-documentos`, completeness bar). Dirección KPI "expediente incompleto".
- No montos exposed (section under proyectos module; obra roles lack it).

### ✅ Done — A3.1 + A4 + A5 (commits `295bfce`, `11532eb`; build passing; migrations live; A9 audited)
- **A3.1** cuadre + kit: `kit_inicio_plantilla` (seeded from Excel: 86 items), `cuadre_obra`,
  `cuadre_items` (per-phase est), `cuadre_consumo` (ledger). `copiar_kit_a_cuadre`.
  `aprobar_requisicion` records consumo vs active phase. `<app-cuadre-obra>` in Proyectos detail.
- **A4** silent antifraud: `parametros` (80/100 thresholds) + Admin>Parámetros; `alertas_cuadre` +
  `evaluar_alerta_cuadre`; Dirección panel + badge + realtime; Gerencia granted `direccion`.
  Verified end-to-end (90%→advertencia, 120%→alerta, dedup). RLS: obra roles see NOTHING.
- **A5** chequeo semanal: `registrar_chequeo_semanal` (diff→alerts), conteos `tipo`,
  Inventario>Conteos "Nuevo chequeo semanal", pg_cron `chequeo-semanal-almacenes` (Mon 06:00)
  → task to each obra's Guarda-Almacén.
- **A9** audit: all 16 new tables RLS on; sensitive (cuadre/consumo/alertas/parametros) gated to
  proyectos/compras/direccion/admin — never bitacora; grants + RPC EXECUTE verified; no montos exposed.

### ✅ Post-review round (merged to main + prod) — 3 adversarial review passes + fixes
- Alert engine hardened: only cuadre-tracked articles alert; "sin estimado en fase" → advertencia
  (no flood); consumo ledger records DISPATCHED qty (no double-count). Re-verified in DB.
- New role **Encargado de Tecnología** (module was admin-only); flota **'equipo'** checklist template seeded.
- Web: Dirección badge refresh + realtime UPDATE on alerts; conteos `tipo` (chequeo badge) + numeric fix;
  expediente % counts no_aplica; requisición split-result numeric defaults; Compras shows origin ("Desde requisición"/"Tecnología").
- **New: Inventario > Reposición** — artículos en/bajo stock mínimo por almacén (obra-safe, sin montos) = the A3.1 reposición signal.
- Dudas expanded (antifraud panel, cuadre/kit, Parámetros, Reposición); CLAUDE.md módulos list updated.
### ✅ Recommendations round (all 5 built + deployed to prod) — `sql/2026-07-13-recomendaciones.sql`
1. **Requisición↔Equipo enforcement** — `sgc.requisicion_permitida` + parámetro `requisicion_validar_equipo`
   (default **FALSE** = no behavior change). Set to `true` in Admin>Parámetros once equipos are configured;
   then only the assigned Ing. Residente/Responsable (or Almacén/Admin) requisitions; projects w/o equipo not blocked.
2. **fase_activa auto-advance** — `cuadre_obra.fase_auto` + `fase_por_avance()` + trigger on `fases_proyecto`;
   cuadre editor has an "auto" toggle (manual change disables it).
3. **`cerrada` estado** — CHECK expanded + trigger auto-closes a requisición when its salida is confirmed
   entregado (and no pending purchase). Web + app labels updated.
4. **Reposición uses kit-minimum** — `sgc.reposicion_almacen` (SECURITY DEFINER, obra-safe) overlays the
   cuadre kit-min on `articulos.stock_minimo`; Reposición page uses it; cuadre add-item exposes "es_min_stock".
5. **Roadmap CL-01..07 schema** — `obra_elementos` / `obra_vaciados` (N° de vaciado) / `obra_no_conformidades`
   (NC-abierta-bloquea-vaciado) tables + RLS/grants. Schema only (no UI yet).

### ✅ Pre-piloto round (deployed to prod) — dashboard por rol + almacén por obra + enforcement
- **Dashboard varía por rol**: cada KPI/gráfico gateado por módulo (`canSee()`); montos de contrato
  solo Dirección/Admin (`canVerMontos`). El ingeniero de obra ya no ve inventario/compras/otras áreas.
  + **Ranking de encargados** compacto en el dashboard (proyectos/dirección; sin montos).
- **Almacén por obra**: `bodegas.proyecto_id` + `es_principal` (migración `sql/2026-07-13-almacen-obra.sql`);
  UI en Almacenes para enlazar un almacén a una obra o marcarlo principal global.
- **Requisición↔Equipo ENCENDIDO** (`requisicion_validar_equipo='true'`). Grace activa: como
  `proyecto_empleados` está vacío, nadie se bloquea hasta que se asignen Residentes/Responsables.
  ⚠️ Al asignar un Ing. Residente a una obra, SOLO ese usuario (empleado con `usuario_id` enlazado)
  podrá requisar esa obra. Para el piloto: dejar el equipo vacío o asignar al ingeniero real.
  Se apaga al instante en Admin → Parámetros si estorba.

### 🟢 LISTO PARA PILOTO (mañana): ingenieros (requisición) + transportistas (checklists pre-uso) vía PWA.
- Web prod: sgcconstructorasd.com · PWA móvil prod: app.sgcconstructorasd.com (ya desplegada).
- APK nativo: NO se pudo compilar aquí (sin Android SDK/adb en este entorno). La PWA cubre el piloto.

### ✅ Ronda flota/proyectos (deployed prod) — pilot enhancements
- **Rutas**: distancia/tiempo automáticos por mapa (origen por GPS "usar mi ubicación" o punto + destino) vía `context/routing.service.ts` (OSRM keyless, swappable a Google con key). `rutas.origen_lat/lng`.
- **Fotos** en vehículos y mantenimientos (bucket `vehiculos`, `fotos text[]`). Multi-chofer por vehículo (se quitó la exclusión).
- **Proyectos — estrellas** (`v_proyecto_readiness`): equipo + cuadre + expediente + almacén de obra; sin las 4 no pasa a "En progreso".
- **Almacén por obra** (`bodegas.proyecto_id/es_principal`) + **catálogo de 86 artículos** sembrado del kit (para entradas rápidas).
- **Dashboard por rol** (cada quien ve solo sus áreas; montos solo Dirección/Admin) + Ranking de encargados en el dashboard.
- **Móvil v1.2.0** (repo csd-app): reportar mantenimiento con fotos + "Cómo llegar" en rutas; renames + checklist pre-uso. **APK firmado construido, instalado al dispositivo (`adb install -r`, smoke-test OK) y publicado** al bucket app-releases (la página CSD App muestra v1.2.0). PWA prod al día.
- RPC nueva compartida: `crear_mantenimiento_app` (captura offline de mantenimiento).

### 🟢 PILOTO LISTO. Nota Google Maps: rutas usan OSRM (keyless) hoy; para métricas de Google dar una Google Directions API key (swap de 1 archivo: context/routing.service.ts).

### PARTE A (A1–A9) + review + recomendaciones + pre-piloto + flota/proyectos — todo en prod.
- **Not pushed/merged yet** — branch `feat/meet-07072026` is local, ~15 commits. Migrations
  ALREADY applied to prod DB (additive, mobile-safe). Merge to `main` → Vercel prod deploy when ready.
- **Parte B** — CSD mobile app (`C:\Users\xavie\Desktop\X Dev\dev2\csd-app`): UI renames
  (Requisición/Almacén), requisición state display, pre-use vehicle checklists (offline outbox,
  RPC `registrar_checklist_vehiculo` already exists + idempotent). NEVER add cuadre/límites/alertas/montos.
- **A4** — silent antifraud engine: hook consumption vs cuadre-por-fase INTO
  `aprobar_requisicion`; alerts table (weather_alerts realtime+RLS pattern) → Dirección panel;
  configurable threshold (needs a new `sgc.parametros` table — none exists). Default 80% warn / 100% alert.
  **NEVER expose montos/cuadres/límites/alerts to obra roles or the mobile app.**
- **A5** — Chequeo semanal de almacén (build on `conteos_inventario`); recurring weekly
  task via pg_cron (pattern: `sql/2026-07-07-weather-cron.sql`) assigned to Guarda-Almacén;
  differences feed A4.
- **A8** — Expediente de inicio de obra (checklist de docs con estado/responsable/adjunto;
  links kit A3.1 + equipo A3.2; **regla dura: obra NUNCA ve montos de contrato**).
  Design roadmap-compatible schemas for CL-01–CL-07, registro de vaciado, NC, etc. (don't build).
- **A9** — full end-to-end verification + RLS/grants audit on every new table +
  verify ingeniero role sees no límites/cuadres/alertas/montos.
- **Parte B** — CSD mobile app (`C:\Users\xavie\Desktop\X Dev\dev2\csd-app`): UI renames
  (Requisición/Almacén), requisición state display, pre-use vehicle checklists (offline outbox).

### Also pending (per feedback memory)
- Update **Dudas FAQ + Soporte** for the rename + new requisición flow (not yet done).

### Tooling
- DB introspection/migrations: `node <scratchpad>/sql.mjs "<SQL>"` or `--file x.sql`
  (Management API, SUPABASE_ACCESS_TOKEN, project ref `jeeqhgccqefbqilntcpu`).
- Build check: `npm run build`.
