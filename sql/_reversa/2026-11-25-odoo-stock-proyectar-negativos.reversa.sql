-- Reversa de sql/2026-11-25-odoo-stock-proyectar-negativos.sql: vuelve a la proyección sin greatest(cantidad, 0).
begin;
create or replace function sgc.odoo_stock_proyectar(p_bodega uuid, p_filas jsonb)
returns integer
language plpgsql
security definer
set search_path to 'sgc', 'pg_temp'
as $function$
declare v_n integer;
begin
  if auth.role() <> 'service_role' then raise exception 'Solo service_role' using errcode = '42501'; end if;
  if not exists (select 1 from sgc.odoo_corte_bodega where bodega_id = p_bodega and fuente_odoo) then return 0; end if;
  perform set_config('sgc.odoo_proyectando', 'true', true);
  with f as (select (x ->> 'odoo_product_id')::bigint as pid, (x ->> 'cantidad')::numeric as cant from jsonb_array_elements(p_filas) x),
  m as (select a.id as articulo_id, f.cant from f join sgc.articulos a on a.odoo_product_id = f.pid)
  insert into sgc.stock_por_bodega (articulo_id, bodega_id, cantidad, updated_at)
  select m.articulo_id, p_bodega, m.cant, now() from m
  on conflict (articulo_id, bodega_id) do update set cantidad = excluded.cantidad, updated_at = now();
  get diagnostics v_n = row_count;
  update sgc.stock_por_bodega s set cantidad = 0, updated_at = now()
   where s.bodega_id = p_bodega and s.cantidad <> 0
     and exists (select 1 from sgc.articulos a where a.id = s.articulo_id and a.odoo_product_id is not null)
     and not exists (select 1 from jsonb_array_elements(p_filas) x join sgc.articulos a on a.odoo_product_id = (x ->> 'odoo_product_id')::bigint where a.id = s.articulo_id);
  perform set_config('sgc.odoo_proyectando', 'false', true);
  return v_n;
end $function$;
commit;
