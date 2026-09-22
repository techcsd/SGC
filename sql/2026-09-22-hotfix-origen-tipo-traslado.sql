-- HOTFIX (detectado por el monitor de errores de prod) — confirmar un conduce cuyo destino
-- es un ALMACÉN nuestro fallaba: conduce_confirmar_receptor inserta la entrada con
-- origen_tipo='traslado_almacen', pero ese valor no estaba en el CHECK de entradas_inventario
-- (solo compra/devolucion_obra/sobrante/otro/recepcion_obra) → violación de constraint y el
-- chofer no podía confirmar. Se agrega 'traslado_almacen' (categoría legítima: traslado entre
-- almacenes). Bug preexistente; salió a la luz con un conduce real hoy.
-- Apply: node scripts/apply-migration.mjs sql/2026-09-22-hotfix-origen-tipo-traslado.sql --env dev  →  --env prod
begin;

alter table sgc.entradas_inventario drop constraint if exists entradas_inventario_origen_tipo_chk;
alter table sgc.entradas_inventario add constraint entradas_inventario_origen_tipo_chk
  check (
    origen_tipo is null
    or origen_tipo = any (array['compra', 'devolucion_obra', 'sobrante', 'otro', 'recepcion_obra', 'traslado_almacen']::text[])
  );

commit;
