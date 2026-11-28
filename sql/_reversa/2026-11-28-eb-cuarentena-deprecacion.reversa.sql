-- Reversa de 2026-11-28-eb-cuarentena-deprecacion.sql (script de rollback: se registra, NO se ejecuta sin OK).
begin;
drop view if exists sgc.v_cuarentena_auditoria;
delete from sgc.parametros where clave = 'inventario_cuarentena_activa';
comment on table sgc.stock_cuarentena is null;
comment on table sgc.stock_cuarentena_mov is null;
comment on column sgc.bodegas.odoo_cuarentena_location_id is null;
commit;
