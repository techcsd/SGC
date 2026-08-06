-- AG16 / PROMPT-8 — Lecturas de solo lectura que la app de campo necesita para el
-- módulo Obra (sugeridas en GESTION-OBRA.md §6.1 / §238). Aditivas, SECURITY DEFINER.

set search_path = sgc, public;

-- 1) mis_nc_asignadas(): bandeja unificada del responsable — NC abiertas donde soy
--    responsable + acciones correctivas asignadas a mí sin verificar. Auto-scoped
--    por auth.uid() (no expone lo de otros).
create or replace function sgc.mis_nc_asignadas()
returns jsonb
language sql
stable
security definer
set search_path to 'sgc', 'pg_temp'
as $function$
  with items as (
    -- No conformidades donde el usuario es responsable directo (sin cerrar)
    select 'nc'::text as clase, nc.id, nc.proyecto_id,
           nc.titulo, nc.descripcion, nc.estado, nc.tipo, nc.severidad,
           nc.ubicacion, nc.fotos, null::date as fecha_compromiso,
           null::text as origen_tipo, null::uuid as origen_id, nc.created_at
    from sgc.obra_no_conformidades nc
    where nc.responsable_id = auth.uid()
      and nc.estado in ('abierta', 'en_correccion')
    union all
    -- Acciones correctivas asignadas al usuario (NC o incidente), sin verificar
    select 'accion'::text, ac.id, ac.proyecto_id,
           null, ac.descripcion, ac.estado, null, null,
           null, ac.evidencia_fotos, ac.fecha_compromiso,
           ac.origen_tipo, ac.origen_id, ac.created_at
    from sgc.obra_acciones_correctivas ac
    where ac.responsable_id = auth.uid()
      and ac.estado <> 'verificada'
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'clase', i.clase, 'id', i.id, 'proyecto_id', i.proyecto_id,
    'proyecto_nombre', p.nombre,
    'titulo', i.titulo, 'descripcion', i.descripcion, 'estado', i.estado,
    'tipo', i.tipo, 'severidad', i.severidad, 'ubicacion', i.ubicacion,
    'fotos', i.fotos, 'fecha_compromiso', i.fecha_compromiso,
    'origen_tipo', i.origen_tipo, 'origen_id', i.origen_id,
    'created_at', i.created_at
  ) order by i.fecha_compromiso asc nulls last, i.created_at desc), '[]'::jsonb)
  from items i
  left join sgc.proyectos p on p.id = i.proyecto_id;
$function$;

grant execute on function sgc.mis_nc_asignadas() to authenticated, service_role;

-- 2) stock_de_obra(p_proyecto_id): igual que existencias_de_obra pero enriquecido
--    con nombre/unidad del artículo para pintar la lista en la app.
create or replace function sgc.stock_de_obra(p_proyecto_id uuid)
returns jsonb
language sql
stable
security definer
set search_path to 'sgc', 'pg_temp'
as $function$
  select coalesce(jsonb_agg(jsonb_build_object(
    'articulo_id', a.id, 'nombre', a.nombre, 'unidad', a.unidad,
    'cantidad', (e.value)::numeric
  ) order by a.nombre), '[]'::jsonb)
  from jsonb_each(sgc.existencias_de_obra(p_proyecto_id)) e
  join sgc.articulos a on a.id = (e.key)::uuid;
$function$;

grant execute on function sgc.stock_de_obra(uuid) to authenticated, service_role;
