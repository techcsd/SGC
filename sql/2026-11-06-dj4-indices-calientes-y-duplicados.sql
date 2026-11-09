-- Issue #70 -- indices (verificado contra el esquema real de dev, no solo
-- contra el texto del issue):
--
-- 1) FKs sin indice en las tablas mas calientes por volumen de lectura
--    (rutas, chofer_posiciones, salidas_inventario, registros_combustible,
--    avisos_flota, incentivo_semana, proveedores) -- confirmados con una
--    consulta contra pg_constraint/pg_index, no copiados a ciegas del issue.
-- 2) Indices EXACTAMENTE duplicados -- solo los que de verdad lo son.
--    fuel_prices e incentivo_informe_version quedan FUERA a proposito: su
--    "duplicado" tiene el ultimo campo en orden ASC en un indice y DESC en
--    el otro -- no son intercambiables para un plan que ordena por ese campo,
--    aunque el issue los liste como duplicados exactos. Las que SI son
--    identicas byte a byte (mismas columnas, mismo orden, mismo predicado):
--    auditoria, bitacora_orden_detalle, obra_avance_snapshots,
--    vehiculo_entregas, y el caso aparte de stock_por_bodega (ver abajo).
-- 3) "Sin uso" (0 scans) del issue NO se tocan aqui -- el propio issue pide
--    confirmar `stats_reset` antes de borrar, y esta ronda no lo verifico;
--    ver docs/PLAN-ISSUES-ABIERTOS-2026-11.md.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '120s';

-- ── 1) Indices nuevos sobre FKs calientes ───────────────────────────────────
create index if not exists idx_avisos_flota_atendido_por on sgc.avisos_flota (atendido_por);
create index if not exists idx_avisos_flota_conductor_id on sgc.avisos_flota (conductor_id);
create index if not exists idx_avisos_flota_reportado_por on sgc.avisos_flota (reportado_por);

create index if not exists idx_chofer_posiciones_vehiculo_id on sgc.chofer_posiciones (vehiculo_id);

create index if not exists idx_incentivo_semana_conductor_id on sgc.incentivo_semana (conductor_id);
create index if not exists idx_incentivo_semana_config_version on sgc.incentivo_semana (config_version);

create index if not exists idx_proveedores_ratificado_por on sgc.proveedores (ratificado_por);

create index if not exists idx_registros_combustible_conductor_id on sgc.registros_combustible (conductor_id);
create index if not exists idx_registros_combustible_factura_id on sgc.registros_combustible (factura_id);
create index if not exists idx_registros_combustible_permiso_id on sgc.registros_combustible (permiso_id);
create index if not exists idx_registros_combustible_proyecto_id on sgc.registros_combustible (proyecto_id);
create index if not exists idx_registros_combustible_reenvio_de on sgc.registros_combustible (reenvio_de);
create index if not exists idx_registros_combustible_registrado_por on sgc.registros_combustible (registrado_por);
create index if not exists idx_registros_combustible_revisada_por on sgc.registros_combustible (revisada_por);

create index if not exists idx_rutas_conductor_id on sgc.rutas (conductor_id);
create index if not exists idx_rutas_creado_por on sgc.rutas (creado_por);
create index if not exists idx_rutas_vehiculo_id on sgc.rutas (vehiculo_id);

create index if not exists idx_salidas_inventario_anulado_por on sgc.salidas_inventario (anulado_por);
create index if not exists idx_salidas_inventario_bodega_id on sgc.salidas_inventario (bodega_id);
create index if not exists idx_salidas_inventario_creado_por on sgc.salidas_inventario (creado_por);
create index if not exists idx_salidas_inventario_despachante_empleado_id on sgc.salidas_inventario (despachante_empleado_id);
create index if not exists idx_salidas_inventario_despachante_usuario_id on sgc.salidas_inventario (despachante_usuario_id);
create index if not exists idx_salidas_inventario_entregado_por on sgc.salidas_inventario (entregado_por);
create index if not exists idx_salidas_inventario_firma_pendiente_usuario_id on sgc.salidas_inventario (firma_pendiente_usuario_id);
create index if not exists idx_salidas_inventario_proyecto_id on sgc.salidas_inventario (proyecto_id);
create index if not exists idx_salidas_inventario_rechazada_por on sgc.salidas_inventario (rechazada_por);
create index if not exists idx_salidas_inventario_recibido_por on sgc.salidas_inventario (recibido_por);
create index if not exists idx_salidas_inventario_vehiculo_id on sgc.salidas_inventario (vehiculo_id);

-- ── 2) Duplicados exactos confirmados ────────────────────────────────────────
-- auditoria: idx_auditoria_actor_creado == ix_auditoria_actor_fecha (mismas
-- columnas, mismo orden, ninguna es constraint) -- se queda la mas reciente.
drop index if exists sgc.idx_auditoria_actor_creado;

-- bitacora_orden_detalle: idx_orden_detalle_bitacora duplica la columna de la
-- constraint unica _bitacora_id_key -- se queda la constraint.
drop index if exists sgc.idx_orden_detalle_bitacora;

-- obra_avance_snapshots: idx_avance_snap_proyecto duplica la constraint unica
-- _proyecto_id_fecha_key (mismas columnas, mismo orden) -- se queda la constraint.
drop index if exists sgc.idx_avance_snap_proyecto;

-- vehiculo_entregas: dos indices unicos parciales IDENTICOS (misma columna,
-- mismo WHERE) creados por separado, ninguno es una constraint con nombre.
drop index if exists sgc.uq_entrega_recepcion_abierta;

-- stock_por_bodega: la constraint unica _articulo_bodega_key es redundante
-- con la PRIMARY KEY sobre las MISMAS columnas (articulo_id, bodega_id) --
-- cualquier FK que referencie estas columnas sigue validando contra la PK.
alter table sgc.stock_por_bodega drop constraint if exists stock_por_bodega_articulo_bodega_key;

commit;
