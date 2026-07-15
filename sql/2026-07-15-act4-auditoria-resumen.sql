-- ============================================================================
-- Actualización 4 — W6: Auditoría analítica (de filas crudas a respuestas)
-- ----------------------------------------------------------------------------
-- RPC de agregación en una sola llamada (jsonb) para el dashboard de auditoría:
-- ranking de usuarios, actividad por módulo/acción/día/hora y acciones comunes,
-- con filtros por rango de fechas, actor y módulo (tabla). La tabla cruda queda
-- como drill-down (list() existente). Mismo gate que el resto del módulo
-- (is_admin OR módulo 'auditoria'). Idempotente.
-- ============================================================================

set search_path = sgc, public;

create or replace function sgc.auditoria_resumen(
  p_desde date default null,
  p_hasta date default null,
  p_actor uuid default null,
  p_tabla text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'sgc', 'pg_temp'
as $function$
declare v_out jsonb;
begin
  if not (sgc.is_admin() or sgc.tiene_modulo('auditoria')) then
    raise exception 'No autorizado.';
  end if;

  with base as (
    select a.tabla, a.accion, a.actor_id, a.creado_en, u.nombre as actor_nombre
    from sgc.auditoria a
    left join sgc.usuarios u on u.id = a.actor_id
    where (p_desde is null or a.creado_en >= p_desde::timestamptz)
      and (p_hasta is null or a.creado_en < ((p_hasta + 1))::timestamptz)
      and (p_actor is null or a.actor_id = p_actor)
      and (p_tabla is null or a.tabla = p_tabla)
  )
  select jsonb_build_object(
    'total', (select count(*) from base),
    'usuarios_activos', (select count(distinct actor_id) from base where actor_id is not null),
    'por_usuario', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select actor_id, coalesce(actor_nombre, '(sistema)') as nombre, count(*) as n
        from base group by actor_id, actor_nombre order by n desc limit 15) x),
    'por_modulo', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select tabla, count(*) as n from base group by tabla order by n desc limit 20) x),
    'por_accion', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select accion, count(*) as n from base group by accion order by n desc) x),
    'por_dia', (select coalesce(jsonb_agg(to_jsonb(x) order by x.dia), '[]'::jsonb) from (
        select to_char(date_trunc('day', creado_en), 'YYYY-MM-DD') as dia, count(*) as n
        from base group by 1) x),
    'por_hora', (select coalesce(jsonb_agg(to_jsonb(x) order by x.hora), '[]'::jsonb) from (
        select extract(hour from creado_en)::int as hora, count(*) as n
        from base group by 1) x),
    'acciones_comunes', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select tabla, accion, count(*) as n from base group by tabla, accion order by n desc limit 12) x)
  ) into v_out;

  return v_out;
end;
$function$;
grant execute on function sgc.auditoria_resumen(date, date, uuid, text) to authenticated, service_role;
