-- ============================================================================
-- CX1 — Administración › Claude: hoy solo se ven las últimas 20 llamadas (sin
-- filtro de error, herramienta o persona) — por eso los "4 con error" de la
-- semana nunca se veían (quedaban fuera de esas 20, casi todas de Xaviel).
-- Extensión ADITIVA de claude_llamadas_recientes: nuevos parámetros opcionales
-- (todos con default = comportamiento IDÉNTICO al de antes), + total para
-- paginar ("Ver más" en vez de un límite silencioso).
-- ============================================================================
begin;

-- Evita overload ambiguo: la vieja firma (1 parámetro) y la nueva (5, todos con
-- default) coinciden al llamar con solo p_limite — se reemplaza, no se suma.
drop function if exists sgc.claude_llamadas_recientes(integer);

create or replace function sgc.claude_llamadas_recientes(
  p_limite integer default 20,
  p_solo_error boolean default false,
  p_herramienta text default null,
  p_usuario uuid default null,
  p_offset integer default 0
)
returns table(hora timestamptz, nombre text, herramienta text, ok boolean, error text, usuario_id uuid, total bigint)
language plpgsql stable security definer set search_path to 'sgc', 'pg_temp'
as $function$
begin
  if not sgc.is_admin() then raise exception 'No autorizado' using errcode = '42501'; end if;
  return query
    select l.creado_en, u.nombre::text, l.herramienta, l.ok, l.error, l.usuario_id,
      count(*) over ()
      from sgc.claude_llamadas l
      join sgc.usuarios u on u.id = l.usuario_id
     where (not p_solo_error or not l.ok)
       and (p_herramienta is null or l.herramienta = p_herramienta)
       and (p_usuario is null or l.usuario_id = p_usuario)
     order by l.creado_en desc
     limit least(coalesce(p_limite, 20), 100)
     offset greatest(coalesce(p_offset, 0), 0);
end;
$function$;
grant execute on function sgc.claude_llamadas_recientes(integer, boolean, text, uuid, integer) to authenticated;

-- Para los selects de filtro (herramienta/persona) de la pantalla.
create or replace function sgc.claude_llamadas_filtros_disponibles()
returns jsonb
language plpgsql stable security definer set search_path to 'sgc', 'pg_temp'
as $function$
begin
  if not sgc.is_admin() then raise exception 'No autorizado' using errcode = '42501'; end if;
  return jsonb_build_object(
    'herramientas', (select coalesce(jsonb_agg(distinct herramienta order by herramienta), '[]'::jsonb) from sgc.claude_llamadas),
    'personas', (select coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'nombre', u.nombre) order by u.nombre), '[]'::jsonb)
                   from (select distinct usuario_id from sgc.claude_llamadas) l2
                   join sgc.usuarios u on u.id = l2.usuario_id)
  );
end;
$function$;
grant execute on function sgc.claude_llamadas_filtros_disponibles() to authenticated;

commit;
