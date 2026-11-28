-- 2026-11-28 -- PROMPT-158 F4 (EB-14/EB20): deprecacion ADITIVA de «cuarentena de stock». Sin DROP.
-- Estado verificado en prod (28-nov, solo lectura): stock_cuarentena = 1 fila con saldo 0; 4 movimientos; 16 bodegas con
-- odoo_cuarentena_location_id; retiros_material = 2 (ambos «dispuesta»), ninguno en cuarentena.
-- Esta migracion NO cambia el flujo: deja el interruptor, documenta la deprecacion y expone una vista de solo lectura para auditoria.
-- Reversa: sql/_reversa/2026-11-28-eb-cuarentena-deprecacion.reversa.sql
begin;
set local lock_timeout = '3s';

insert into sgc.parametros (clave, valor, descripcion) values
  ('inventario_cuarentena_activa', 'true', 'EB-14: true = el retiro de material danado sigue pasando por cuarentena. Pasara a false cuando el retiro se resuelva por desecho/baja directa (ver docs/EB-F4-CUARENTENA.md).')
on conflict (clave) do nothing;

comment on table sgc.stock_cuarentena is 'DEPRECADA (EB-14, 28-nov-2026): la cuarentena de stock se retira; el material danado ira a desecho/baja directa. No borrar: auditoria.';
comment on table sgc.stock_cuarentena_mov is 'DEPRECADA (EB-14, 28-nov-2026): historial de la cuarentena de stock. No borrar: auditoria.';
comment on column sgc.bodegas.odoo_cuarentena_location_id is 'DEPRECADA (EB-14, 28-nov-2026): ubicacion «Cuarentena SGC <codigo>» en Odoo; Chai las archiva cuando el saldo sea 0. No borrar la columna.';

create or replace view sgc.v_cuarentena_auditoria with (security_invoker = true) as
  select 'saldo'::text as tipo, c.articulo_id, c.bodega_id, c.cantidad, null::timestamptz as cuando
    from sgc.stock_cuarentena c;
comment on view sgc.v_cuarentena_auditoria is 'EB-14: vista de solo lectura del saldo de cuarentena para auditoria mientras dure la deprecacion.';
grant select on sgc.v_cuarentena_auditoria to authenticated;

commit;
