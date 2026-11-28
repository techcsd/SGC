-- Reversa de 2026-11-28-eb-ubicaciones.sql (script de rollback: se registra, NO se ejecuta sin OK).
-- Es aditiva; esta reversa solo se usaria si no hay datos que conservar en las tablas nuevas.
begin;
drop function if exists sgc.bodega_ubicacion_marcar_principal(uuid);
drop function if exists sgc.stock_por_bodega_ubicacion(uuid, uuid);
drop function if exists sgc.odoo_stock_ubicacion_proyectar(uuid, jsonb);
drop function if exists sgc.odoo_bodega_ubicaciones_sincronizar(uuid, jsonb);
drop table if exists sgc.stock_por_ubicacion;
drop table if exists sgc.obra_ubicaciones;
drop table if exists sgc.bodega_ubicaciones;
commit;
