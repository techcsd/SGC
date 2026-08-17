-- ============================================================================
-- PROMPT-17 (AS) — FASE 4 — Compras: gastos directos del proyecto (AS14),
--   filtro por zona en proyectos (AS23). (AS22 proveedores con ubicación = web,
--   reusa location-picker + columnas lat/lng ya existentes AF32.)
--   Aditivo / retrocompatible.
-- ----------------------------------------------------------------------------
--   AS14: el historial de "Compras por proyecto" sale de compras_de_proyecto()
--         = UNION de ordenes_compra + entradas_inventario(ferretería). NO de
--         requisiciones. Aquí se añade una 3ª fuente: GASTOS DIRECTOS (sin
--         requisición): concepto, categoría (catálogo flexible), monto, fecha,
--         foto de recibo opc., quién registró. Suma al gasto real, etiquetado
--         aparte de las compras formales.
--   AS23: filtro por ubicación en el listado de proyectos → campo estructurado
--         `zona` (texto libre con datalist de zonas usadas). La cercanía por
--         coordenadas queda v2.
-- ============================================================================

set search_path = sgc, public;

-- ════════════════════════════════════════════════════════════════════════════
-- AS14 — Catálogo flexible de categorías de gasto (patrón tec_categorias AD5)
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists sgc.gasto_categorias (
  id         uuid primary key default gen_random_uuid(),
  clave      text unique not null,
  label      text not null,
  orden      int  not null default 100,
  activo     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table sgc.gasto_categorias enable row level security;
drop policy if exists gasto_categorias_sel on sgc.gasto_categorias;
create policy gasto_categorias_sel on sgc.gasto_categorias for select to authenticated using (true);
drop policy if exists gasto_categorias_wr on sgc.gasto_categorias;
create policy gasto_categorias_wr on sgc.gasto_categorias for all to authenticated
  using (sgc.is_admin() or sgc.tiene_modulo('compras') or sgc.tiene_modulo('proyectos'))
  with check (sgc.is_admin() or sgc.tiene_modulo('compras') or sgc.tiene_modulo('proyectos'));

insert into sgc.gasto_categorias (clave, label, orden) values
  ('alimentacion',        'Alimentación',            10),
  ('transporte',          'Transporte / pasaje',     20),
  ('combustible_menor',   'Combustible (menor)',     30),
  ('herramientas_menores','Herramientas menores',    40),
  ('hospedaje',           'Hospedaje',               50),
  ('servicios',           'Servicios / utilidades',  60),
  ('imprevistos',         'Imprevistos',             70),
  ('misc',                'Misceláneos',             999)
on conflict (clave) do nothing;

-- ════════════════════════════════════════════════════════════════════════════
-- AS14 — Tabla de gastos directos del proyecto
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists sgc.gastos_directos (
  id              uuid primary key default gen_random_uuid(),
  proyecto_id     uuid not null references sgc.proyectos(id) on delete cascade,
  categoria_clave text not null default 'misc' references sgc.gasto_categorias(clave),
  concepto        text not null,
  monto           numeric not null check (monto > 0),
  fecha           date not null default current_date,
  recibo_path     text,
  registrado_por  uuid references sgc.usuarios(id) on delete set null,
  es_prueba       boolean not null default false,
  es_prueba_origen text,
  created_at      timestamptz not null default now()
);
create index if not exists idx_gastos_directos_proyecto on sgc.gastos_directos (proyecto_id, fecha desc);

alter table sgc.gastos_directos enable row level security;
-- Lectura/escritura defensiva (el detalle real va por RPC SECURITY DEFINER).
drop policy if exists gastos_directos_rw on sgc.gastos_directos;
create policy gastos_directos_rw on sgc.gastos_directos for all to authenticated
  using (sgc.is_admin() or sgc.tiene_modulo('compras') or sgc.tiene_modulo('proyectos') or sgc.tiene_modulo('obra') or sgc.tiene_modulo('direccion'))
  with check (sgc.is_admin() or sgc.tiene_modulo('compras') or sgc.tiene_modulo('proyectos') or sgc.tiene_modulo('obra') or sgc.tiene_modulo('direccion'));
-- es_prueba: oculta a no-admin (patrón T2b).
drop policy if exists gastos_directos_prueba on sgc.gastos_directos;
create policy gastos_directos_prueba on sgc.gastos_directos as restrictive for select to authenticated
  using ((not es_prueba) or sgc.is_admin());

-- Permiso para registrar (mismo universo que compras_de_proyecto).
create or replace function sgc.puede_registrar_gasto_directo(p_proyecto_id uuid)
returns boolean language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select sgc.is_admin()
    or sgc.tiene_modulo('compras') or sgc.tiene_modulo('proyectos')
    or sgc.tiene_modulo('obra') or sgc.tiene_modulo('direccion')
    or sgc.es_responsable_de_proyecto(p_proyecto_id)
    or exists (select 1 from sgc.proyecto_empleados pe
               join sgc.empleados e on e.id = pe.empleado_id
               where pe.proyecto_id = p_proyecto_id and e.usuario_id = auth.uid());
$$;
grant execute on function sgc.puede_registrar_gasto_directo(uuid) to authenticated, service_role;

create or replace function sgc.registrar_gasto_directo(
  p_id          uuid,
  p_proyecto_id uuid,
  p_categoria   text,
  p_concepto    text,
  p_monto       numeric,
  p_fecha       date default null,
  p_recibo_path text default null
) returns uuid
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'No autenticado'; end if;
  if not sgc.puede_registrar_gasto_directo(p_proyecto_id) then
    raise exception 'No autorizado para registrar gastos en este proyecto.' using errcode = '42501';
  end if;
  if nullif(trim(coalesce(p_concepto,'')),'') is null then
    raise exception 'El concepto del gasto es obligatorio.';
  end if;
  if p_monto is null or p_monto <= 0 then
    raise exception 'El monto del gasto debe ser mayor que cero.';
  end if;

  insert into sgc.gastos_directos (id, proyecto_id, categoria_clave, concepto, monto, fecha, recibo_path, registrado_por)
  values (coalesce(p_id, gen_random_uuid()), p_proyecto_id,
          coalesce(nullif(p_categoria,''),'misc'), trim(p_concepto), p_monto,
          coalesce(p_fecha, current_date), nullif(p_recibo_path,''), auth.uid())
  on conflict (id) do nothing
  returning id into v_id;

  return coalesce(v_id, p_id);
end;
$$;
grant execute on function sgc.registrar_gasto_directo(uuid, uuid, text, text, numeric, date, text) to authenticated, service_role;

-- Listado detallado de gastos directos de un proyecto.
create or replace function sgc.gastos_directos_de_proyecto(
  p_proyecto_id uuid, p_desde date default null, p_hasta date default null)
returns table (
  id uuid, fecha date, categoria_clave text, categoria text,
  concepto text, monto numeric, recibo_path text,
  registrado_por uuid, registrado_por_nombre text, created_at timestamptz)
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select g.id, g.fecha, g.categoria_clave, coalesce(c.label, g.categoria_clave) as categoria,
         g.concepto, g.monto, g.recibo_path,
         g.registrado_por, sgc.nombre_usuario(g.registrado_por), g.created_at
  from sgc.gastos_directos g
  left join sgc.gasto_categorias c on c.clave = g.categoria_clave
  where g.proyecto_id = p_proyecto_id
    and sgc.puede_registrar_gasto_directo(p_proyecto_id)
    and (sgc.is_admin() or not coalesce(g.es_prueba, false))
    and (p_desde is null or g.fecha >= p_desde)
    and (p_hasta is null or g.fecha <= p_hasta)
  order by g.fecha desc, g.created_at desc;
$$;
grant execute on function sgc.gastos_directos_de_proyecto(uuid, date, date) to authenticated, service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- AS14 — compras_de_proyecto: 3ª fuente = gastos directos (etiquetada aparte)
-- ════════════════════════════════════════════════════════════════════════════
create or replace function sgc.compras_de_proyecto(
  p_proyecto_id uuid, p_desde date default null, p_hasta date default null)
returns table (
  tipo text, id uuid, fecha date, proveedor text, total numeric, estado text, referencia text)
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $function$
  with perm as (
    select (
      sgc.is_admin()
      or sgc.tiene_modulo('proyectos') or sgc.tiene_modulo('compras') or sgc.tiene_modulo('obra')
      or exists (select 1 from sgc.proyectos p where p.id = p_proyecto_id and p.responsable_id = auth.uid())
      or exists (select 1 from sgc.proyecto_empleados pe
                 join sgc.empleados e on e.id = pe.empleado_id
                 where pe.proyecto_id = p_proyecto_id and e.usuario_id = auth.uid())
    ) as ok
  ),
  es_admin as (select sgc.is_admin() as v)
  select 'orden_compra'::text as tipo, oc.id, oc.fecha, pr.nombre as proveedor,
         oc.total, oc.estado, oc.numero as referencia
  from sgc.ordenes_compra oc
  cross join perm cross join es_admin
  left join sgc.proveedores pr on pr.id = oc.proveedor_id
  where perm.ok and oc.proyecto_id = p_proyecto_id
    and (es_admin.v or not coalesce(oc.es_prueba, false))
    and (p_desde is null or oc.fecha >= p_desde) and (p_hasta is null or oc.fecha <= p_hasta)

  union all

  select 'ferreteria'::text as tipo, e.id, e.fecha, pr.nombre as proveedor,
         (select sum(coalesce(de.cantidad,0) * coalesce(de.precio_unit,0))
            from sgc.detalle_entradas de where de.entrada_id = e.id) as total,
         case when coalesce(e.pendiente_confirmacion, false) then 'pendiente' else 'confirmada' end as estado,
         e.referencia
  from sgc.entradas_inventario e
  cross join perm cross join es_admin
  left join sgc.proveedores pr on pr.id = e.proveedor_id
  where perm.ok and e.origen_tipo = 'compra' and e.origen_proyecto_id = p_proyecto_id
    and (es_admin.v or not coalesce(e.es_prueba, false))
    and (p_desde is null or e.fecha >= p_desde) and (p_hasta is null or e.fecha <= p_hasta)

  union all

  -- AS14 — gastos directos (sin requisición), etiquetados aparte.
  select 'gasto_directo'::text as tipo, g.id, g.fecha,
         null::text as proveedor, g.monto as total,
         'registrado'::text as estado,
         coalesce(c.label, g.categoria_clave) || ' · ' || g.concepto as referencia
  from sgc.gastos_directos g
  cross join perm cross join es_admin
  left join sgc.gasto_categorias c on c.clave = g.categoria_clave
  where perm.ok and g.proyecto_id = p_proyecto_id
    and (es_admin.v or not coalesce(g.es_prueba, false))
    and (p_desde is null or g.fecha >= p_desde) and (p_hasta is null or g.fecha <= p_hasta)

  order by fecha desc nulls last;
$function$;
grant execute on function sgc.compras_de_proyecto(uuid, date, date) to authenticated, service_role;

-- Gasto real del proyecto = OC (aprobada|recibida) + gastos directos. Usado por el
-- detalle del proyecto (para que los gastos directos SUMEN al gasto real).
create or replace function sgc.gasto_real_proyecto(p_proyecto_id uuid)
returns numeric
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select
    coalesce((select sum(oc.total) from sgc.ordenes_compra oc
              where oc.proyecto_id = p_proyecto_id
                and oc.estado in ('aprobada','recibida')
                and (sgc.is_admin() or not coalesce(oc.es_prueba,false))), 0)
    + coalesce((select sum(g.monto) from sgc.gastos_directos g
              where g.proyecto_id = p_proyecto_id
                and (sgc.is_admin() or not coalesce(g.es_prueba,false))), 0);
$$;
grant execute on function sgc.gasto_real_proyecto(uuid) to authenticated, service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- AS23 — Proyectos: campo estructurado de zona para filtrar
-- ════════════════════════════════════════════════════════════════════════════
alter table sgc.proyectos add column if not exists zona text;
comment on column sgc.proyectos.zona is
  'AS23 — zona/sector para filtrar el listado (p.ej. Punta Cana, Cap Cana, Santo Domingo). Texto libre homologado por datalist en el form.';
