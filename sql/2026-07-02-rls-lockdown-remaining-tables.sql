-- ═══════════════════════════════════════════════════════════
-- RLS lockdown, remaining tables — same pattern confirmed on
-- sgc.proyectos/sgc.fases_proyecto: admin or the module that owns this
-- data can read/write; no cross-module or team-membership join is added
-- unless the current frontend actually relies on cross-module reads
-- (verified per-table below by grepping actual .from() usage before
-- writing each policy, not assumed from table names).
--
-- Detail/child tables (detalle_entradas, detalle_salidas,
-- orden_compra_items) get the same module check directly rather than a
-- join to their header table — unlike solicitud_material_items/
-- solicitud_compra_items, nobody needs a narrower "my own row" scope
-- here, so the extra join would add complexity with no behavior change.
-- ═══════════════════════════════════════════════════════════

-- ── Inventario ────────────────────────────────────────────────
-- Verified: compras/ordenes.ts never reads articulos (item lines are
-- free-text, articulo_id is always null there) — no cross-module grant
-- needed.
drop policy "articulos: insert" on sgc.articulos;
drop policy "articulos: update" on sgc.articulos;
create policy "articulos: select" on sgc.articulos for select to authenticated
  using (sgc.is_admin() or sgc.tiene_modulo('inventario'));
create policy "articulos: insert" on sgc.articulos for insert to authenticated
  with check (sgc.is_admin() or sgc.tiene_modulo('inventario'));
create policy "articulos: update" on sgc.articulos for update to authenticated
  using (sgc.is_admin() or sgc.tiene_modulo('inventario'))
  with check (sgc.is_admin() or sgc.tiene_modulo('inventario'));
-- (no delete policy existed before either — articulos are soft-deleted via `activo`)

drop policy "stock_por_bodega: all" on sgc.stock_por_bodega;
create policy "stock_por_bodega: select" on sgc.stock_por_bodega for select to authenticated
  using (sgc.is_admin() or sgc.tiene_modulo('inventario'));
create policy "stock_por_bodega: insert" on sgc.stock_por_bodega for insert to authenticated
  with check (sgc.is_admin() or sgc.tiene_modulo('inventario'));
create policy "stock_por_bodega: update" on sgc.stock_por_bodega for update to authenticated
  using (sgc.is_admin() or sgc.tiene_modulo('inventario'))
  with check (sgc.is_admin() or sgc.tiene_modulo('inventario'));
create policy "stock_por_bodega: delete" on sgc.stock_por_bodega for delete to authenticated
  using (sgc.is_admin() or sgc.tiene_modulo('inventario'));
grant select, insert, update, delete on sgc.stock_por_bodega to authenticated;

drop policy "bodegas: all" on sgc.bodegas;
create policy "bodegas: select" on sgc.bodegas for select to authenticated
  using (sgc.is_admin() or sgc.tiene_modulo('inventario'));
create policy "bodegas: insert" on sgc.bodegas for insert to authenticated
  with check (sgc.is_admin() or sgc.tiene_modulo('inventario'));
create policy "bodegas: update" on sgc.bodegas for update to authenticated
  using (sgc.is_admin() or sgc.tiene_modulo('inventario'))
  with check (sgc.is_admin() or sgc.tiene_modulo('inventario'));
create policy "bodegas: delete" on sgc.bodegas for delete to authenticated
  using (sgc.is_admin() or sgc.tiene_modulo('inventario'));
grant select, insert, update, delete on sgc.bodegas to authenticated;

drop policy "activos_fijos: all" on sgc.activos_fijos;
create policy "activos_fijos: select" on sgc.activos_fijos for select to authenticated
  using (sgc.is_admin() or sgc.tiene_modulo('inventario'));
create policy "activos_fijos: insert" on sgc.activos_fijos for insert to authenticated
  with check (sgc.is_admin() or sgc.tiene_modulo('inventario'));
create policy "activos_fijos: update" on sgc.activos_fijos for update to authenticated
  using (sgc.is_admin() or sgc.tiene_modulo('inventario'))
  with check (sgc.is_admin() or sgc.tiene_modulo('inventario'));
create policy "activos_fijos: delete" on sgc.activos_fijos for delete to authenticated
  using (sgc.is_admin() or sgc.tiene_modulo('inventario'));
grant select, insert, update, delete on sgc.activos_fijos to authenticated;

drop policy "entradas_inventario: all" on sgc.entradas_inventario;
create policy "entradas_inventario: select" on sgc.entradas_inventario for select to authenticated
  using (sgc.is_admin() or sgc.tiene_modulo('inventario'));
create policy "entradas_inventario: insert" on sgc.entradas_inventario for insert to authenticated
  with check (sgc.is_admin() or sgc.tiene_modulo('inventario'));
create policy "entradas_inventario: update" on sgc.entradas_inventario for update to authenticated
  using (sgc.is_admin() or sgc.tiene_modulo('inventario'))
  with check (sgc.is_admin() or sgc.tiene_modulo('inventario'));
create policy "entradas_inventario: delete" on sgc.entradas_inventario for delete to authenticated
  using (sgc.is_admin() or sgc.tiene_modulo('inventario'));
grant select, insert, update, delete on sgc.entradas_inventario to authenticated;

drop policy "detalle_entradas: all" on sgc.detalle_entradas;
create policy "detalle_entradas: select" on sgc.detalle_entradas for select to authenticated
  using (sgc.is_admin() or sgc.tiene_modulo('inventario'));
create policy "detalle_entradas: insert" on sgc.detalle_entradas for insert to authenticated
  with check (sgc.is_admin() or sgc.tiene_modulo('inventario'));
create policy "detalle_entradas: update" on sgc.detalle_entradas for update to authenticated
  using (sgc.is_admin() or sgc.tiene_modulo('inventario'))
  with check (sgc.is_admin() or sgc.tiene_modulo('inventario'));
create policy "detalle_entradas: delete" on sgc.detalle_entradas for delete to authenticated
  using (sgc.is_admin() or sgc.tiene_modulo('inventario'));
grant select, insert, update, delete on sgc.detalle_entradas to authenticated;

-- salidas_inventario/detalle_salidas: no engineer read path today (an
-- engineer only ever sees their own solicitud's `estado`, not the salida
-- record it links to) — kept to admin/inventario only, matching current
-- UI usage. Revisit if a future "ver mi entrega" feature needs it.
drop policy "salidas: insert" on sgc.salidas_inventario;
drop policy "salidas_inventario: all" on sgc.salidas_inventario;
create policy "salidas_inventario: select" on sgc.salidas_inventario for select to authenticated
  using (sgc.is_admin() or sgc.tiene_modulo('inventario'));
create policy "salidas_inventario: insert" on sgc.salidas_inventario for insert to authenticated
  with check (sgc.is_admin() or sgc.tiene_modulo('inventario'));
create policy "salidas_inventario: update" on sgc.salidas_inventario for update to authenticated
  using (sgc.is_admin() or sgc.tiene_modulo('inventario'))
  with check (sgc.is_admin() or sgc.tiene_modulo('inventario'));
create policy "salidas_inventario: delete" on sgc.salidas_inventario for delete to authenticated
  using (sgc.is_admin() or sgc.tiene_modulo('inventario'));
grant select, insert, update, delete on sgc.salidas_inventario to authenticated;

drop policy "detalle_salidas: all" on sgc.detalle_salidas;
create policy "detalle_salidas: select" on sgc.detalle_salidas for select to authenticated
  using (sgc.is_admin() or sgc.tiene_modulo('inventario'));
create policy "detalle_salidas: insert" on sgc.detalle_salidas for insert to authenticated
  with check (sgc.is_admin() or sgc.tiene_modulo('inventario'));
create policy "detalle_salidas: update" on sgc.detalle_salidas for update to authenticated
  using (sgc.is_admin() or sgc.tiene_modulo('inventario'))
  with check (sgc.is_admin() or sgc.tiene_modulo('inventario'));
create policy "detalle_salidas: delete" on sgc.detalle_salidas for delete to authenticated
  using (sgc.is_admin() or sgc.tiene_modulo('inventario'));
grant select, insert, update, delete on sgc.detalle_salidas to authenticated;

-- ── Compras ───────────────────────────────────────────────────
drop policy "proveedores: all" on sgc.proveedores;
create policy "proveedores: select" on sgc.proveedores for select to authenticated
  using (sgc.is_admin() or sgc.tiene_modulo('compras'));
create policy "proveedores: insert" on sgc.proveedores for insert to authenticated
  with check (sgc.is_admin() or sgc.tiene_modulo('compras'));
create policy "proveedores: update" on sgc.proveedores for update to authenticated
  using (sgc.is_admin() or sgc.tiene_modulo('compras'))
  with check (sgc.is_admin() or sgc.tiene_modulo('compras'));
create policy "proveedores: delete" on sgc.proveedores for delete to authenticated
  using (sgc.is_admin() or sgc.tiene_modulo('compras'));
grant select, insert, update, delete on sgc.proveedores to authenticated;

drop policy "ordenes_compra: all" on sgc.ordenes_compra;
create policy "ordenes_compra: select" on sgc.ordenes_compra for select to authenticated
  using (sgc.is_admin() or sgc.tiene_modulo('compras'));
create policy "ordenes_compra: insert" on sgc.ordenes_compra for insert to authenticated
  with check (sgc.is_admin() or sgc.tiene_modulo('compras'));
create policy "ordenes_compra: update" on sgc.ordenes_compra for update to authenticated
  using (sgc.is_admin() or sgc.tiene_modulo('compras'))
  with check (sgc.is_admin() or sgc.tiene_modulo('compras'));
create policy "ordenes_compra: delete" on sgc.ordenes_compra for delete to authenticated
  using (sgc.is_admin() or sgc.tiene_modulo('compras'));
grant select, insert, update, delete on sgc.ordenes_compra to authenticated;

drop policy "orden_items: all" on sgc.orden_compra_items;
create policy "orden_compra_items: select" on sgc.orden_compra_items for select to authenticated
  using (sgc.is_admin() or sgc.tiene_modulo('compras'));
create policy "orden_compra_items: insert" on sgc.orden_compra_items for insert to authenticated
  with check (sgc.is_admin() or sgc.tiene_modulo('compras'));
create policy "orden_compra_items: update" on sgc.orden_compra_items for update to authenticated
  using (sgc.is_admin() or sgc.tiene_modulo('compras'))
  with check (sgc.is_admin() or sgc.tiene_modulo('compras'));
create policy "orden_compra_items: delete" on sgc.orden_compra_items for delete to authenticated
  using (sgc.is_admin() or sgc.tiene_modulo('compras'));
grant select, insert, update, delete on sgc.orden_compra_items to authenticated;

-- ── Flota ─────────────────────────────────────────────────────
-- conductores has no usuario_id (drivers don't have app logins), so no
-- self-visibility path is possible or needed here.
drop policy "conductores: all" on sgc.conductores;
create policy "conductores: select" on sgc.conductores for select to authenticated
  using (sgc.is_admin() or sgc.tiene_modulo('flota'));
create policy "conductores: insert" on sgc.conductores for insert to authenticated
  with check (sgc.is_admin() or sgc.tiene_modulo('flota'));
create policy "conductores: update" on sgc.conductores for update to authenticated
  using (sgc.is_admin() or sgc.tiene_modulo('flota'))
  with check (sgc.is_admin() or sgc.tiene_modulo('flota'));
create policy "conductores: delete" on sgc.conductores for delete to authenticated
  using (sgc.is_admin() or sgc.tiene_modulo('flota'));
grant select, insert, update, delete on sgc.conductores to authenticated;

drop policy "mantenimientos: all" on sgc.mantenimientos;
create policy "mantenimientos: select" on sgc.mantenimientos for select to authenticated
  using (sgc.is_admin() or sgc.tiene_modulo('flota'));
create policy "mantenimientos: insert" on sgc.mantenimientos for insert to authenticated
  with check (sgc.is_admin() or sgc.tiene_modulo('flota'));
create policy "mantenimientos: update" on sgc.mantenimientos for update to authenticated
  using (sgc.is_admin() or sgc.tiene_modulo('flota'))
  with check (sgc.is_admin() or sgc.tiene_modulo('flota'));
create policy "mantenimientos: delete" on sgc.mantenimientos for delete to authenticated
  using (sgc.is_admin() or sgc.tiene_modulo('flota'));
grant select, insert, update, delete on sgc.mantenimientos to authenticated;

drop policy "rutas: all" on sgc.rutas;
create policy "rutas: select" on sgc.rutas for select to authenticated
  using (sgc.is_admin() or sgc.tiene_modulo('flota'));
create policy "rutas: insert" on sgc.rutas for insert to authenticated
  with check (sgc.is_admin() or sgc.tiene_modulo('flota'));
create policy "rutas: update" on sgc.rutas for update to authenticated
  using (sgc.is_admin() or sgc.tiene_modulo('flota'))
  with check (sgc.is_admin() or sgc.tiene_modulo('flota'));
create policy "rutas: delete" on sgc.rutas for delete to authenticated
  using (sgc.is_admin() or sgc.tiene_modulo('flota'));
grant select, insert, update, delete on sgc.rutas to authenticated;

drop policy "combustible: all" on sgc.registros_combustible;
create policy "registros_combustible: select" on sgc.registros_combustible for select to authenticated
  using (sgc.is_admin() or sgc.tiene_modulo('flota'));
create policy "registros_combustible: insert" on sgc.registros_combustible for insert to authenticated
  with check (sgc.is_admin() or sgc.tiene_modulo('flota'));
create policy "registros_combustible: update" on sgc.registros_combustible for update to authenticated
  using (sgc.is_admin() or sgc.tiene_modulo('flota'))
  with check (sgc.is_admin() or sgc.tiene_modulo('flota'));
create policy "registros_combustible: delete" on sgc.registros_combustible for delete to authenticated
  using (sgc.is_admin() or sgc.tiene_modulo('flota'));
grant select, insert, update, delete on sgc.registros_combustible to authenticated;

-- ── RRHH ──────────────────────────────────────────────────────
drop policy "asistencia: all" on sgc.asistencia;
create policy "asistencia: select" on sgc.asistencia for select to authenticated
  using (sgc.is_admin() or sgc.tiene_modulo('rrhh'));
create policy "asistencia: insert" on sgc.asistencia for insert to authenticated
  with check (sgc.is_admin() or sgc.tiene_modulo('rrhh'));
create policy "asistencia: update" on sgc.asistencia for update to authenticated
  using (sgc.is_admin() or sgc.tiene_modulo('rrhh'))
  with check (sgc.is_admin() or sgc.tiene_modulo('rrhh'));
create policy "asistencia: delete" on sgc.asistencia for delete to authenticated
  using (sgc.is_admin() or sgc.tiene_modulo('rrhh'));
grant select, insert, update, delete on sgc.asistencia to authenticated;

-- ═══════════════════════════════════════════════════════════
-- KNOWN SIDE EFFECT (expected, not a bug): the Dashboard shows
-- company-wide overview KPIs (valor de inventario, stock crítico, gasto
-- de compras del mes, proyectos activos, etc.) to EVERY authenticated
-- user regardless of role — that was only possible because these tables
-- had no real RLS. Now that they're scoped, a user without the relevant
-- module (e.g. an RRHH-only or bitacora-only account) will see those
-- specific KPIs read back as 0/empty instead of the true company-wide
-- number, since RLS silently filters the underlying rows to nothing
-- rather than erroring. This is the correct, intended behavior of real
-- authorization — flagging it explicitly since it's a visible dashboard
-- change, not something to "fix" by loosening these policies back up.
-- ═══════════════════════════════════════════════════════════
