-- 2026-11-17 -- DS-29 (corte Opcion A: Odoo manda). (1) respaldo del stock SGC de una bodega antes de pasarla a fuente Odoo;
-- (2) la proyeccion pone en 0 los articulos homologados que Odoo no tiene en esa ubicacion (antes dejaba el valor viejo de SGC).
create table if not exists sgc.odoo_corte_respaldo_stock (
  id bigint generated always as identity primary key,
  bodega_id uuid not null references sgc.bodegas(id),
  articulo_id uuid not null,
  cantidad numeric not null,
  respaldado_en timestamptz not null default now(),
  motivo text
);
alter table sgc.odoo_corte_respaldo_stock enable row level security;
revoke all on sgc.odoo_corte_respaldo_stock from public, anon, authenticated;
grant all on sgc.odoo_corte_respaldo_stock to service_role;
create policy odoo_corte_respaldo_stock_admin on sgc.odoo_corte_respaldo_stock for select to authenticated using ((select sgc.is_admin()));
grant select on sgc.odoo_corte_respaldo_stock to authenticated;

create or replace function sgc.odoo_stock_proyectar(p_bodega uuid, p_filas jsonb)
returns integer language plpgsql security definer set search_path = sgc, pg_temp as $fn$
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
  -- Odoo manda: un articulo homologado sin quant en la ubicacion tiene 0 (no conserva el valor viejo de SGC).
  update sgc.stock_por_bodega s set cantidad = 0, updated_at = now()
   where s.bodega_id = p_bodega and s.cantidad <> 0
     and exists (select 1 from sgc.articulos a where a.id = s.articulo_id and a.odoo_product_id is not null)
     and not exists (select 1 from jsonb_array_elements(p_filas) x join sgc.articulos a on a.odoo_product_id = (x ->> 'odoo_product_id')::bigint where a.id = s.articulo_id);
  perform set_config('sgc.odoo_proyectando', 'false', true);
  return v_n;
end $fn$;
