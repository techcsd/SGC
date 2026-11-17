-- DS-10 (ronda DS, 16-nov-2026): identidad y estado de sincronizacion Odoo en salidas_inventario (ADR 21). ADITIVA.
-- Traslado con transito en 2 pasos: picking A (origen->transito) al despachar; picking B (transito->destino) al llegar.
-- Publicacion apagada por defecto: sin fila habilitada en sgc.odoo_publicacion_politica no se publica nada.
alter table sgc.salidas_inventario
  add column if not exists odoo_instancia_id uuid references sgc.odoo_instancias(id),
  add column if not exists odoo_picking_salida_id bigint,
  add column if not exists odoo_picking_entrada_id bigint,
  add column if not exists odoo_sync_estado text,
  add column if not exists odoo_sync_error text,
  add column if not exists odoo_sync_intentos integer not null default 0,
  add column if not exists odoo_sync_en timestamptz;
comment on column sgc.salidas_inventario.odoo_picking_salida_id is 'DS-10 picking A (origen->transito) en Odoo';
comment on column sgc.salidas_inventario.odoo_picking_entrada_id is 'DS-10 picking B (transito->destino) en Odoo';

do $c$ begin
  if not exists (select 1 from pg_constraint where conrelid='sgc.salidas_inventario'::regclass and conname='salidas_odoo_sync_estado_ck') then
    alter table sgc.salidas_inventario add constraint salidas_odoo_sync_estado_ck
      check (odoo_sync_estado is null or odoo_sync_estado in ('pendiente','sincronizado','incierto','error'));
    alter table sgc.salidas_inventario add constraint salidas_odoo_ids_ck
      check ((odoo_picking_salida_id is null or odoo_picking_salida_id > 0) and (odoo_picking_entrada_id is null or odoo_picking_entrada_id > 0)
             and (odoo_picking_salida_id is null and odoo_picking_entrada_id is null or odoo_instancia_id is not null));
  end if;
end $c$;
create unique index if not exists salidas_odoo_picking_salida_uq on sgc.salidas_inventario(odoo_instancia_id, odoo_picking_salida_id) where odoo_picking_salida_id is not null;
create unique index if not exists salidas_odoo_picking_entrada_uq on sgc.salidas_inventario(odoo_instancia_id, odoo_picking_entrada_id) where odoo_picking_entrada_id is not null;
create index if not exists salidas_odoo_sync_pend_ix on sgc.salidas_inventario(odoo_sync_estado) where odoo_sync_estado in ('pendiente','incierto','error');

drop trigger if exists odoo_v1_proteger_campos on sgc.salidas_inventario;
create trigger odoo_v1_proteger_campos before insert or update on sgc.salidas_inventario
  for each row execute function sgc.odoo_v1_proteger_campos(
    'odoo_instancia_id','odoo_picking_salida_id','odoo_picking_entrada_id','odoo_sync_estado','odoo_sync_error','odoo_sync_en');
