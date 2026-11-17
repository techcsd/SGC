-- DS-05 (ronda DS, 16-nov-2026): codigo de almacen de Odoo en las bodegas de SGC.
-- ADITIVA. Por instancia: los ids/codigos de staging pueden diferir de los de prod.
--   codigo_odoo      <= 5 caracteres, sin espacios, unico por odoo_instancia_id
--   codigo_odoo_raw  lo que dice Odoo tal cual (p.ej. 'OF VC' con espacio)
-- Reservadas al integrador (mismo trigger odoo_v1_proteger_campos que el resto de identidades).
alter table sgc.bodegas
  add column if not exists codigo_odoo text,
  add column if not exists codigo_odoo_raw text;
comment on column sgc.bodegas.codigo_odoo is 'DS-05 codigo corto del stock.warehouse de Odoo (normalizado)';
comment on column sgc.bodegas.codigo_odoo_raw is 'DS-05 codigo de Odoo tal cual vino (puede tener espacios)';

do $c$ begin
  if not exists (select 1 from pg_constraint where conrelid='sgc.bodegas'::regclass and conname='bodegas_codigo_odoo_ck') then
    alter table sgc.bodegas add constraint bodegas_codigo_odoo_ck
      check (codigo_odoo is null or (codigo_odoo ~ '^[^[:space:]]{1,5}$' and odoo_instancia_id is not null));
  end if;
end $c$;
create unique index if not exists bodegas_codigo_odoo_uq on sgc.bodegas(odoo_instancia_id, codigo_odoo) where codigo_odoo is not null;

drop trigger if exists odoo_v1_proteger_campos on sgc.bodegas;
create trigger odoo_v1_proteger_campos before insert or update on sgc.bodegas
  for each row execute function sgc.odoo_v1_proteger_campos(
    'odoo_instancia_id','odoo_compania_id','odoo_location_id','odoo_warehouse_id','odoo_ultima_sync','odoo_version',
    'codigo_odoo','codigo_odoo_raw');
