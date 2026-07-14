-- ============================================================================
-- Mejoras 14/07/2026 — R27 Roles nuevos (presets, sin módulos nuevos)
-- ----------------------------------------------------------------------------
-- Todos los flujos de la reunión mapean a módulos existentes. NO se crean
-- módulos nuevos (evita el gotcha recurrente). Sólo presets de rol nuevos,
-- idempotentes por codigo. Xavier puede borrar los que no use en Admin>Roles.
--   - Chofer / Transportista  -> {flota}       (chofer de campo: pre-uso, combustible, reporte semanal, rutas)
--   - Guarda-Almacén          -> {inventario}  (encargado de almacén de obra)
-- ============================================================================

set search_path = sgc, public;

insert into sgc.roles (codigo, nombre, modulos)
select 'chofer_transportista', 'Chofer / Transportista', array['flota']::text[]
 where not exists (select 1 from sgc.roles where codigo = 'chofer_transportista');

insert into sgc.roles (codigo, nombre, modulos)
select 'guarda_almacen', 'Guarda-Almacén', array['inventario']::text[]
 where not exists (select 1 from sgc.roles where codigo = 'guarda_almacen');
