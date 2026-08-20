-- AS7 — Bandeja de requisiciones ("todas") para roles con función de requisición.
-- ADITIVO y de SOLO LECTURA: tres RPCs SECURITY DEFINER. No altera tablas, RLS,
-- triggers ni RPCs existentes → no puede romper la web. Reutiliza el gate ya
-- existente `puede_ver_todas_requisiciones()` (admin/módulo inventario/gerente
-- producción/gerente proyectos/jefe ingenieros). "Mis requisiciones" sigue igual
-- (select directo con RLS); esto es la bandeja global para gestionar/observar.

-- 1) Listado filtrable de todas las requisiciones visibles para el rol.
create or replace function sgc.requisiciones_bandeja(
  p_estado      text default null,
  p_proyecto_id uuid default null,
  p_urgencia    text default null,
  p_busqueda    text default null,
  p_limite      int  default 100
) returns table (
  id uuid, estado text, urgencia text, notas text, created_at timestamptz,
  proyecto_id uuid, proyecto_nombre text,
  solicitante_id uuid, solicitante_nombre text,
  items_count int, tiene_conduce boolean, tiene_compra boolean
)
language sql
stable
security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select s.id, s.estado, s.urgencia, s.notas, s.created_at,
         s.proyecto_id, p.nombre as proyecto_nombre,
         s.solicitante_id, u.nombre as solicitante_nombre,
         (select count(*)::int from sgc.solicitud_material_items i where i.solicitud_id = s.id) as items_count,
         (s.salida_id is not null) as tiene_conduce,
         (s.solicitud_compra_id is not null) as tiene_compra
  from sgc.solicitudes_material s
  left join sgc.proyectos p on p.id = s.proyecto_id
  left join sgc.usuarios  u on u.id = s.solicitante_id
  where sgc.puede_ver_todas_requisiciones()
    and (p_estado      is null or s.estado = p_estado)
    and (p_proyecto_id is null or s.proyecto_id = p_proyecto_id)
    and (p_urgencia    is null or s.urgencia = p_urgencia)
    and (
      p_busqueda is null or p_busqueda = ''
      or p.nombre ilike '%' || p_busqueda || '%'
      or u.nombre ilike '%' || p_busqueda || '%'
      or exists (
        select 1 from sgc.solicitud_material_items i
        where i.solicitud_id = s.id and i.descripcion ilike '%' || p_busqueda || '%'
      )
    )
  order by
    case s.estado when 'pendiente' then 0 when 'aprobada' then 1 else 2 end,
    case s.urgencia when 'urgente' then 0 else 1 end,
    s.created_at desc
  limit coalesce(p_limite, 100);
$$;

-- 2) Detalle completo de una requisición (visible por el rol o por su solicitante).
create or replace function sgc.requisicion_detalle(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare
  v_owner uuid;
  v jsonb;
begin
  select solicitante_id into v_owner from sgc.solicitudes_material where id = p_id;
  if v_owner is null then return null; end if;
  if not (sgc.puede_ver_todas_requisiciones() or v_owner = auth.uid()) then
    raise exception 'No autorizado' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'id', s.id, 'estado', s.estado, 'urgencia', s.urgencia, 'notas', s.notas,
    'created_at', s.created_at, 'updated_at', s.updated_at, 'atendido_en', s.atendido_en,
    'proyecto_id', s.proyecto_id, 'proyecto_nombre', p.nombre,
    'solicitante_id', s.solicitante_id, 'solicitante_nombre', u.nombre,
    'atendido_por_nombre', ua.nombre,
    'salida_id', s.salida_id, 'solicitud_compra_id', s.solicitud_compra_id,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id,
        'descripcion', coalesce(nullif(i.descripcion, ''), a.nombre),
        'cantidad', i.cantidad, 'unidad', i.unidad, 'talla', i.talla,
        'articulo_id', i.articulo_id, 'codigo', a.codigo
      ) order by coalesce(nullif(i.descripcion, ''), a.nombre))
      from sgc.solicitud_material_items i
      left join sgc.articulos a on a.id = i.articulo_id
      where i.solicitud_id = s.id
    ), '[]'::jsonb)
  ) into v
  from sgc.solicitudes_material s
  left join sgc.proyectos p on p.id = s.proyecto_id
  left join sgc.usuarios  u on u.id = s.solicitante_id
  left join sgc.usuarios  ua on ua.id = s.atendido_por
  where s.id = p_id;

  return v;
end;
$$;

-- 3) Conteo de pendientes para el badge de la bandeja (0 si el rol no la ve).
create or replace function sgc.requisiciones_bandeja_count()
returns int
language sql
stable
security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select case when sgc.puede_ver_todas_requisiciones()
    then (select count(*)::int from sgc.solicitudes_material where estado = 'pendiente')
    else 0 end;
$$;

grant execute on function sgc.requisiciones_bandeja(text, uuid, text, text, int) to authenticated;
grant execute on function sgc.requisicion_detalle(uuid) to authenticated;
grant execute on function sgc.requisiciones_bandeja_count() to authenticated;
