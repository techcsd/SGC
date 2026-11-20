-- DT (hotfix Raykler) — la app necesita saber qué almacenes tienen a Odoo como fuente de stock
-- para avisar en Inventario › Conteo que un conteo desde la app puede revertirse (Odoo manda).
-- Aditiva y de solo lectura: un booleano por almacén, sin datos sensibles. No cambia
-- registrar_conteo_app ni adjust_stock (decisión Xaviel 20-nov: Odoo manda el stock).
create or replace function sgc.bodegas_fuente_stock()
returns table (bodega_id uuid, fuente_odoo boolean)
language sql
stable
security definer
set search_path = sgc, public
as $$
  select b.id,
         exists (select 1 from sgc.odoo_corte_bodega o where o.bodega_id = b.id and o.fuente_odoo)
  from sgc.bodegas b
  where auth.uid() is not null
$$;

revoke all on function sgc.bodegas_fuente_stock() from public, anon;
grant execute on function sgc.bodegas_fuente_stock() to authenticated;
