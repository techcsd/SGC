-- 2026-11-17 -- DS: (1) «Pendientes en Odoo»: lo que el menu Inventario de Odoo muestra como «Por procesar» / «Atrasado» (recepciones, entregas
-- e internos sin validar), cruzado con lo que SGC conoce (OC y conduces). (2) Reabastecimiento: reglas de minimo/maximo de SGC -> reglas de
-- reabastecimiento de Odoo (stock.warehouse.orderpoint, disparador manual: solo avisan, nunca compran solas). ADITIVA.
-- Solo la edge `odoo-conciliar` (service_role) escribe; Tecnologia lee. Sin hosts/usuarios/ids de Odoo en el repo (publico).

create table if not exists sgc.odoo_pendientes (
  odoo_instancia_id uuid not null references sgc.odoo_instancias(id),
  picking_id bigint not null,
  nombre text not null,
  origin text,
  tipo text not null check (tipo in ('recepcion','entrega','interno','otro')),
  estado text not null,
  programada timestamptz,
  almacen text,
  odoo_warehouse_id bigint,
  bodega_id uuid references sgc.bodegas(id) on delete set null,
  oc_odoo_id bigint,
  oc_id uuid references sgc.ordenes_compra(id) on delete set null,
  salida_id uuid references sgc.salidas_inventario(id) on delete set null,
  conocido boolean not null default false,       -- SGC tiene la OC o el conduce de origen
  visto_en timestamptz not null default now(),
  primary key (odoo_instancia_id, picking_id)
);
create index if not exists odoo_pendientes_bodega_ix on sgc.odoo_pendientes(odoo_instancia_id, odoo_warehouse_id, tipo);
alter table sgc.odoo_pendientes enable row level security;
drop policy if exists odoo_pendientes_sel on sgc.odoo_pendientes;
create policy odoo_pendientes_sel on sgc.odoo_pendientes for select to authenticated using (sgc.es_tecnologia());
grant select on sgc.odoo_pendientes to authenticated;
grant all on sgc.odoo_pendientes to service_role;

create table if not exists sgc.odoo_reabastecimiento_reglas (
  articulo_id uuid primary key references sgc.articulos(id) on delete cascade,
  odoo_instancia_id uuid not null references sgc.odoo_instancias(id),
  odoo_orderpoint_id bigint not null,
  minimo numeric not null,
  maximo numeric not null,
  activa boolean not null default true,
  sincronizado_en timestamptz not null default now()
);
alter table sgc.odoo_reabastecimiento_reglas enable row level security;
drop policy if exists odoo_reab_sel on sgc.odoo_reabastecimiento_reglas;
create policy odoo_reab_sel on sgc.odoo_reabastecimiento_reglas for select to authenticated using (sgc.es_tecnologia());
grant select on sgc.odoo_reabastecimiento_reglas to authenticated;
grant all on sgc.odoo_reabastecimiento_reglas to service_role;

insert into sgc.parametros (clave, valor) values ('odoo_reabastecimiento_almacen', 'WH')
on conflict (clave) do nothing;

-- Reemplaza la foto de pendientes de la instancia (lo que ya no esta pendiente en Odoo se borra) y cruza con OC / conduces de SGC.
create or replace function sgc.odoo_pendientes_sincronizar(p_instancia uuid, p_filas jsonb)
returns jsonb language plpgsql security definer set search_path = sgc, pg_temp as $fn$
declare v_n int; v_conocidos int;
begin
  delete from sgc.odoo_pendientes where odoo_instancia_id = p_instancia
    and picking_id not in (select (f->>'picking_id')::bigint from jsonb_array_elements(coalesce(p_filas,'[]'::jsonb)) f);
  insert into sgc.odoo_pendientes (odoo_instancia_id, picking_id, nombre, origin, tipo, estado, programada, almacen, odoo_warehouse_id, oc_odoo_id, visto_en)
  select p_instancia, (f->>'picking_id')::bigint, coalesce(f->>'nombre','?'), nullif(f->>'origin',''), coalesce(f->>'tipo','otro'), coalesce(f->>'estado','?'),
         nullif(f->>'programada','')::timestamptz, nullif(f->>'almacen',''), nullif(f->>'odoo_warehouse_id','')::bigint, nullif(f->>'oc_odoo_id','')::bigint, now()
  from jsonb_array_elements(coalesce(p_filas,'[]'::jsonb)) f
  on conflict (odoo_instancia_id, picking_id) do update set nombre = excluded.nombre, origin = excluded.origin, tipo = excluded.tipo, estado = excluded.estado,
    programada = excluded.programada, almacen = excluded.almacen, odoo_warehouse_id = excluded.odoo_warehouse_id, oc_odoo_id = excluded.oc_odoo_id, visto_en = now();
  update sgc.odoo_pendientes p set
    bodega_id = (select b.id from sgc.bodegas b where b.odoo_instancia_id = p_instancia and b.odoo_warehouse_id = p.odoo_warehouse_id limit 1),
    oc_id = (select o.id from sgc.ordenes_compra o where o.odoo_instancia_id = p_instancia and o.odoo_id = p.oc_odoo_id limit 1),
    salida_id = (select s.id from sgc.salidas_inventario s where p.origin like 'SGC-TRAS-' || s.id::text || '%' limit 1)
  where p.odoo_instancia_id = p_instancia;
  update sgc.odoo_pendientes set conocido = (oc_id is not null or salida_id is not null) where odoo_instancia_id = p_instancia;
  select count(*), count(*) filter (where conocido) into v_n, v_conocidos from sgc.odoo_pendientes where odoo_instancia_id = p_instancia;
  return jsonb_build_object('pendientes', v_n, 'conocidos', v_conocidos);
end $fn$;

-- Resumen para la pantalla: tarjetas por almacen y tipo (como el tablero de Odoo) + lista de los mas atrasados.
create or replace function sgc.odoo_pendientes_resumen()
returns jsonb language plpgsql stable security definer set search_path = sgc, pg_temp as $fn$
declare v_inst uuid;
begin
  if not sgc.es_tecnologia() then raise exception 'Solo Tecnologia puede ver los pendientes de Odoo' using errcode = '42501'; end if;
  select id into v_inst from sgc.odoo_instancias where habilitada limit 1;
  return jsonb_build_object(
    'actualizado_en', (select max(visto_en) from sgc.odoo_pendientes where odoo_instancia_id = v_inst),
    'por_almacen', coalesce((select jsonb_agg(to_jsonb(x) order by x.atrasados desc, x.almacen) from (
        select coalesce(almacen, 'Sin almacén') as almacen, tipo, count(*)::int as por_procesar,
               count(*) filter (where programada < now())::int as atrasados,
               count(*) filter (where conocido)::int as conocidos_sgc
        from sgc.odoo_pendientes where odoo_instancia_id = v_inst group by 1, 2) x), '[]'::jsonb),
    'lista', coalesce((select jsonb_agg(to_jsonb(l)) from (
        select p.picking_id, p.nombre, p.origin, p.tipo, p.estado, p.programada, p.almacen, p.conocido,
               (p.oc_id is not null) as oc_sgc, (p.salida_id is not null) as conduce_sgc
        from sgc.odoo_pendientes p where p.odoo_instancia_id = v_inst order by p.programada nulls last limit 100) l), '[]'::jsonb),
    'reglas', jsonb_build_object(
        'activas', (select count(*) from sgc.odoo_reabastecimiento_reglas where odoo_instancia_id = v_inst and activa),
        'ultima', (select max(sincronizado_en) from sgc.odoo_reabastecimiento_reglas where odoo_instancia_id = v_inst)));
end $fn$;

-- Insumos del sincronizador de reglas: articulos con minimo (vinculados a Odoo) y las reglas que SGC ya creo.
create or replace function sgc.odoo_reabastecimiento_cargar(p_instancia uuid)
returns jsonb language sql stable security definer set search_path = sgc, pg_temp as $fn$
  select jsonb_build_object(
    'articulos', coalesce((select jsonb_agg(jsonb_build_object('articulo_id', a.id, 'odoo_product_id', a.odoo_product_id,
        'minimo', a.stock_minimo, 'maximo', coalesce(a.stock_maximo, a.stock_minimo)))
      from sgc.articulos a where a.odoo_product_id is not null and coalesce(a.stock_minimo, 0) > 0 and coalesce(a.activo, true)), '[]'::jsonb),
    'reglas', coalesce((select jsonb_agg(jsonb_build_object('articulo_id', r.articulo_id, 'orderpoint_id', r.odoo_orderpoint_id,
        'minimo', r.minimo, 'maximo', r.maximo, 'activa', r.activa, 'odoo_product_id', a.odoo_product_id))
      from sgc.odoo_reabastecimiento_reglas r join sgc.articulos a on a.id = r.articulo_id where r.odoo_instancia_id = p_instancia), '[]'::jsonb));
$fn$;

create or replace function sgc.odoo_reabastecimiento_registrar(p_instancia uuid, p_articulo uuid, p_orderpoint bigint, p_minimo numeric, p_maximo numeric, p_activa boolean)
returns void language sql security definer set search_path = sgc, pg_temp as $fn$
  insert into sgc.odoo_reabastecimiento_reglas (articulo_id, odoo_instancia_id, odoo_orderpoint_id, minimo, maximo, activa, sincronizado_en)
  values (p_articulo, p_instancia, p_orderpoint, p_minimo, p_maximo, p_activa, now())
  on conflict (articulo_id) do update set odoo_orderpoint_id = excluded.odoo_orderpoint_id, minimo = excluded.minimo, maximo = excluded.maximo,
    activa = excluded.activa, sincronizado_en = now();
$fn$;

revoke all on function sgc.odoo_pendientes_sincronizar(uuid, jsonb), sgc.odoo_pendientes_resumen(), sgc.odoo_reabastecimiento_cargar(uuid),
  sgc.odoo_reabastecimiento_registrar(uuid, uuid, bigint, numeric, numeric, boolean) from public, anon;
grant execute on function sgc.odoo_pendientes_resumen() to authenticated;
grant execute on function sgc.odoo_pendientes_sincronizar(uuid, jsonb), sgc.odoo_reabastecimiento_cargar(uuid),
  sgc.odoo_reabastecimiento_registrar(uuid, uuid, bigint, numeric, numeric, boolean) to service_role;
