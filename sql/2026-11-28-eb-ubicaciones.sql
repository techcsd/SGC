-- 2026-11-28 -- PROMPT-158 F3 (EB-09/10/12): ubicaciones dentro de un almacen + obras como ubicaciones de Odoo.
-- Un almacen de Odoo puede tener varias ubicaciones hijas (p. ej. Central: una por tipo de material). Odoo muestra el stock
-- global del almacen (suma de hijas, child_of) o segmentado por ubicacion. SGC mapeaba cada bodega a UNA ubicacion.
-- ADITIVA y compatible hacia atras: una bodega SIN filas en bodega_ubicaciones se comporta exactamente como hoy
-- (1 ubicacion implicita = bodegas.odoo_location_id); stock_por_bodega sigue siendo el total del almacen.
-- Sin DROP. Reversa: sql/_reversa/2026-11-28-eb-ubicaciones.reversa.sql
begin;
set local lock_timeout = '3s';

-- ── 1. Ubicaciones de un almacen (arbol) ────────────────────────────────────
create table if not exists sgc.bodega_ubicaciones (
  id uuid primary key default gen_random_uuid(),
  bodega_id uuid not null references sgc.bodegas(id) on delete cascade,
  odoo_location_id bigint not null check (odoo_location_id > 0),
  padre_id uuid references sgc.bodega_ubicaciones(id) on delete set null,
  nombre text not null,
  ruta text not null,
  principal boolean not null default false,
  activa boolean not null default true,
  es_prueba boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (bodega_id, odoo_location_id)
);
-- A lo sumo UNA principal por almacen.
create unique index if not exists bodega_ubicaciones_una_principal on sgc.bodega_ubicaciones (bodega_id) where principal and activa;
create index if not exists bodega_ubicaciones_bodega_idx on sgc.bodega_ubicaciones (bodega_id);
create index if not exists bodega_ubicaciones_padre_idx on sgc.bodega_ubicaciones (padre_id);
comment on table sgc.bodega_ubicaciones is 'EB-09: arbol de ubicaciones de Odoo bajo la ubicacion de cada bodega. Sin filas = 1 ubicacion implicita (bodegas.odoo_location_id).';

-- ── 2. Stock por ubicacion (proyeccion de Odoo; el total del almacen sigue en stock_por_bodega) ──
create table if not exists sgc.stock_por_ubicacion (
  articulo_id uuid not null references sgc.articulos(id) on delete cascade,
  ubicacion_id uuid not null references sgc.bodega_ubicaciones(id) on delete cascade,
  cantidad numeric not null default 0,
  updated_at timestamptz not null default now(),
  primary key (articulo_id, ubicacion_id)
);
create index if not exists stock_por_ubicacion_ubic_idx on sgc.stock_por_ubicacion (ubicacion_id);
comment on table sgc.stock_por_ubicacion is 'EB-09: stock del articulo en cada ubicacion de un almacen (proyeccion de Odoo, stock.quant). stock_por_bodega = suma de las ubicaciones del arbol.';

-- ── 3. Obras = ubicaciones de Odoo (destino de un conduce a obra) ───────────
create table if not exists sgc.obra_ubicaciones (
  proyecto_id uuid primary key references sgc.proyectos(id) on delete cascade,
  odoo_location_id bigint not null check (odoo_location_id > 0),
  nombre text,
  activa boolean not null default true,
  es_prueba boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table sgc.obra_ubicaciones is 'EB-12: ubicacion de Odoo que representa a una obra. Sin fila = conduce «pendiente de ubicacion de obra» (nunca al transito generico). La ubicacion la crea Chai en Odoo; SGC solo la vincula.';

-- ── 4. RLS: lectura a autenticados (referencia, como stock_por_bodega); escritura admin/inventario ──
do $$
declare t text;
begin
  foreach t in array array['bodega_ubicaciones', 'stock_por_ubicacion', 'obra_ubicaciones'] loop
    execute format('alter table sgc.%I enable row level security', t);
    execute format('drop policy if exists %I on sgc.%I', t || ': referencia autenticados', t);
    execute format('create policy %I on sgc.%I for select to authenticated using ((select auth.uid()) is not null)', t || ': referencia autenticados', t);
    execute format('drop policy if exists %I on sgc.%I', t || ': escritura', t);
    execute format('create policy %I on sgc.%I for all to authenticated using ((select sgc.is_admin()) or (select sgc.tiene_modulo(''inventario'')) or (select sgc.es_tecnologia())) with check ((select sgc.is_admin()) or (select sgc.tiene_modulo(''inventario'')) or (select sgc.es_tecnologia()))', t || ': escritura', t);
    execute format('grant select on sgc.%I to authenticated', t);
    execute format('grant select, insert, update, delete on sgc.%I to authenticated, service_role', t);
  end loop;
  -- es_prueba: misma politica restrictiva que el resto de tablas con la columna.
  foreach t in array array['bodega_ubicaciones', 'obra_ubicaciones'] loop
    execute format('drop policy if exists %I on sgc.%I', 'es_prueba: oculta a no-admin', t);
    execute format('create policy %I on sgc.%I as restrictive for select to authenticated using ((not es_prueba) or (select sgc.is_admin()) or (select sgc.usuario_actual_es_prueba()))', 'es_prueba: oculta a no-admin', t);
  end loop;
end $$;

-- ── 5. Sincronizar el arbol de ubicaciones de una bodega desde Odoo (service_role, idempotente) ──
-- p_filas: [{odoo_location_id, padre_odoo_location_id|null, nombre, ruta, activa}]. La ubicacion de la bodega es la raiz y la
-- «principal» por defecto; una marca de principal hecha a mano por Tecnologia se respeta. Lo que ya no viene de Odoo se desactiva.
create or replace function sgc.odoo_bodega_ubicaciones_sincronizar(p_bodega uuid, p_filas jsonb)
returns integer language plpgsql security definer set search_path = sgc, pg_temp as $fn$
declare v_raiz bigint; v_n integer := 0; v_hay_principal boolean;
begin
  if auth.role() <> 'service_role' then raise exception 'Solo service_role' using errcode = '42501'; end if;
  select odoo_location_id into v_raiz from sgc.bodegas where id = p_bodega;
  if v_raiz is null then return 0; end if;

  insert into sgc.bodega_ubicaciones (bodega_id, odoo_location_id, nombre, ruta, activa, updated_at)
  select p_bodega, (x ->> 'odoo_location_id')::bigint, left(coalesce(x ->> 'nombre', '?'), 200), left(coalesce(x ->> 'ruta', x ->> 'nombre', '?'), 500),
         coalesce((x ->> 'activa')::boolean, true), now()
    from jsonb_array_elements(p_filas) x
   where (x ->> 'odoo_location_id') ~ '^[0-9]+$'
  on conflict (bodega_id, odoo_location_id) do update set nombre = excluded.nombre, ruta = excluded.ruta, activa = excluded.activa, updated_at = now();
  get diagnostics v_n = row_count;

  -- Padres (segunda pasada: ya existen todas las filas).
  update sgc.bodega_ubicaciones u set padre_id = p.id
    from jsonb_array_elements(p_filas) x
    join sgc.bodega_ubicaciones p on p.bodega_id = p_bodega and p.odoo_location_id = (x ->> 'padre_odoo_location_id')::bigint
   where u.bodega_id = p_bodega and u.odoo_location_id = (x ->> 'odoo_location_id')::bigint
     and (x ->> 'padre_odoo_location_id') ~ '^[0-9]+$' and u.padre_id is distinct from p.id;

  -- Lo que Odoo ya no trae (ubicacion archivada/borrada) se desactiva, no se borra (el historial puede apuntarle).
  update sgc.bodega_ubicaciones u set activa = false, principal = false, updated_at = now()
   where u.bodega_id = p_bodega and u.activa
     and not exists (select 1 from jsonb_array_elements(p_filas) x where (x ->> 'odoo_location_id') = u.odoo_location_id::text);

  -- Principal: la de la bodega, si nadie marco otra.
  select exists (select 1 from sgc.bodega_ubicaciones where bodega_id = p_bodega and principal and activa) into v_hay_principal;
  if not v_hay_principal then
    update sgc.bodega_ubicaciones set principal = true where bodega_id = p_bodega and odoo_location_id = v_raiz and activa;
  end if;
  return v_n;
end $fn$;
revoke all on function sgc.odoo_bodega_ubicaciones_sincronizar(uuid, jsonb) from public, anon, authenticated;
grant execute on function sgc.odoo_bodega_ubicaciones_sincronizar(uuid, jsonb) to service_role;

-- ── 6. Proyectar stock por ubicacion (service_role). p_filas: [{odoo_location_id, odoo_product_id, cantidad}] ──
create or replace function sgc.odoo_stock_ubicacion_proyectar(p_bodega uuid, p_filas jsonb)
returns integer language plpgsql security definer set search_path = sgc, pg_temp as $fn$
declare v_n integer;
begin
  if auth.role() <> 'service_role' then raise exception 'Solo service_role' using errcode = '42501'; end if;
  with f as (
    select (x ->> 'odoo_location_id')::bigint lid, (x ->> 'odoo_product_id')::bigint pid, sum(greatest((x ->> 'cantidad')::numeric, 0)) cant
      from jsonb_array_elements(p_filas) x group by 1, 2),
  m as (select a.id articulo_id, u.id ubicacion_id, f.cant
          from f join sgc.articulos a on a.odoo_product_id = f.pid
          join sgc.bodega_ubicaciones u on u.bodega_id = p_bodega and u.odoo_location_id = f.lid and u.activa)
  insert into sgc.stock_por_ubicacion (articulo_id, ubicacion_id, cantidad, updated_at)
  select articulo_id, ubicacion_id, cant, now() from m
  on conflict (articulo_id, ubicacion_id) do update set cantidad = excluded.cantidad, updated_at = now();
  get diagnostics v_n = row_count;
  -- Odoo manda: lo que ya no tiene quant en esa ubicacion queda en 0.
  update sgc.stock_por_ubicacion s set cantidad = 0, updated_at = now()
   where s.cantidad <> 0 and s.ubicacion_id in (select id from sgc.bodega_ubicaciones where bodega_id = p_bodega)
     and not exists (select 1 from jsonb_array_elements(p_filas) x join sgc.articulos a on a.odoo_product_id = (x ->> 'odoo_product_id')::bigint
                      join sgc.bodega_ubicaciones u on u.bodega_id = p_bodega and u.odoo_location_id = (x ->> 'odoo_location_id')::bigint
                      where a.id = s.articulo_id and u.id = s.ubicacion_id);
  return v_n;
end $fn$;
revoke all on function sgc.odoo_stock_ubicacion_proyectar(uuid, jsonb) from public, anon, authenticated;
grant execute on function sgc.odoo_stock_ubicacion_proyectar(uuid, jsonb) to service_role;

-- ── 7. Lectura para web y app (contrato compartido con PROMPT-159): stock de un articulo por ubicacion de un almacen ──
-- Sin subdivisiones: devuelve UNA fila implicita con el total del almacen (comportamiento de siempre).
create or replace function sgc.stock_por_bodega_ubicacion(p_articulo uuid, p_bodega uuid)
returns table (ubicacion_id uuid, odoo_location_id bigint, nombre text, ruta text, principal boolean, cantidad numeric, implicita boolean)
language plpgsql stable security invoker set search_path = sgc, pg_temp as $fn$
begin
  if exists (select 1 from sgc.bodega_ubicaciones u where u.bodega_id = p_bodega and u.activa) then
    return query
      select u.id, u.odoo_location_id, u.nombre, u.ruta, u.principal, coalesce(s.cantidad, 0), false
        from sgc.bodega_ubicaciones u
        left join sgc.stock_por_ubicacion s on s.ubicacion_id = u.id and s.articulo_id = p_articulo
       where u.bodega_id = p_bodega and u.activa
       order by u.principal desc, u.ruta;
  else
    return query
      select null::uuid, b.odoo_location_id::bigint, b.nombre::text, b.nombre::text, true, coalesce(sb.cantidad, 0), true
        from sgc.bodegas b
        left join sgc.stock_por_bodega sb on sb.bodega_id = b.id and sb.articulo_id = p_articulo
       where b.id = p_bodega;
  end if;
end $fn$;
revoke all on function sgc.stock_por_bodega_ubicacion(uuid, uuid) from public, anon;
grant execute on function sgc.stock_por_bodega_ubicacion(uuid, uuid) to authenticated, service_role;

-- ── 8. Marcar la ubicacion principal (Tecnologia / admin / inventario) ──
create or replace function sgc.bodega_ubicacion_marcar_principal(p_ubicacion uuid)
returns boolean language plpgsql security definer set search_path = sgc, pg_temp as $fn$
declare v_bodega uuid;
begin
  if not (sgc.is_admin() or sgc.es_tecnologia() or sgc.tiene_modulo('inventario')) then raise exception 'Sin permiso' using errcode = '42501'; end if;
  select bodega_id into v_bodega from sgc.bodega_ubicaciones where id = p_ubicacion and activa;
  if v_bodega is null then raise exception 'Ubicacion no encontrada o inactiva'; end if;
  update sgc.bodega_ubicaciones set principal = false, updated_at = now() where bodega_id = v_bodega and principal and id <> p_ubicacion;
  update sgc.bodega_ubicaciones set principal = true, updated_at = now() where id = p_ubicacion;
  return true;
end $fn$;
revoke all on function sgc.bodega_ubicacion_marcar_principal(uuid) from public, anon;
grant execute on function sgc.bodega_ubicacion_marcar_principal(uuid) to authenticated;

commit;
