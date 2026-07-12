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

### ⏳ Pending — A3(.1) cuadre+kit, A4, A5, A8, A9 (not started)
- **A3 + A3.1** — cuadre inicial + 4 fases 25/50/75/100 (extend `fases_proyecto`,
  new `cuadre_*` tables), Kit de inicio plantilla (3 cats ALMACÉN/OFICINA/COCINA Y BAÑO,
  flag prorrateado, seed from the Excel; also = A8 "materiales mínimos" + stock mínimo por obra).
  Consumption discount hooks INTO `aprobar_requisicion` (needs A2 QA first).
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
