-- BQ10 — Dos tools nuevas de Compa (top del backlog sin_tool)  ·  14/09/2026
-- ---------------------------------------------------------------------------------
-- Del backlog real (assistant_consultas_no_atendidas, todas sin_tool):
--   · "REQ-000040 dónde consigo este conduce" → buscar_folio
--   · "qué trajo la última actualización" / "en qué versión salió X" (×4) → changelog_reciente
-- Ambas security definer + grant.  Se registran en el edge assistant (TOOLS[]).
-- Validar begin/rollback.  Aplicar con OK.
-- ---------------------------------------------------------------------------------

-- Buscar una requisición por su folio (REQ-######, o solo los dígitos).
create or replace function sgc.buscar_folio(p_folio text)
returns jsonb
language plpgsql stable security definer
set search_path to 'sgc','pg_temp'
as $function$
declare v_num bigint;
begin
  if not (sgc.is_admin() or sgc.tiene_modulo('inventario') or sgc.tiene_modulo('compras')) then
    raise exception 'Requiere el módulo inventario o compras' using errcode = '42501';
  end if;
  v_num := nullif(regexp_replace(coalesce(p_folio,''), '\D', '', 'g'), '')::bigint;
  if v_num is null then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'tipo', 'requisicion',
      'id', s.id,
      'codigo', 'REQ-' || lpad(s.folio::text, 6, '0'),
      'estado', s.estado,
      'obra', p.nombre,
      'ruta', '/inventario/requisiciones?req=' || s.id::text
    ))
    from sgc.solicitudes_material s
    left join sgc.proyectos p on p.id = s.proyecto_id
    where s.folio = v_num
  ), '[]'::jsonb);
end;
$function$;
grant execute on function sgc.buscar_folio(text) to authenticated;

-- Changelog: últimas versiones publicadas (web y app), con notas estructuradas.
create or replace function sgc.changelog_reciente(p_limite integer default 8)
returns jsonb
language sql stable security definer
set search_path to 'sgc','pg_temp'
as $function$
  select coalesce(jsonb_agg(x order by x.created_at desc), '[]'::jsonb)
  from (
    select v.plataforma, v.version, v.titulo, v.cambios, v.fecha, v.url, v.created_at
    from sgc.app_versiones v
    order by v.created_at desc
    limit greatest(1, least(coalesce(p_limite, 8), 30))
  ) x;
$function$;
grant execute on function sgc.changelog_reciente(integer) to authenticated;
