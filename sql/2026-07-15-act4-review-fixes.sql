-- ============================================================================
-- Actualización 4 — correcciones de la revisión de código
--   [1] registrar_version es SECURITY DEFINER: gatear a is_admin() para que un
--       usuario autenticado NO pueda escribir en app_versiones (tabla admin-only
--       por RLS). El auto-registro web se dispara solo cuando un admin abre el
--       nuevo deploy (el front también lo limita a admins).
--   [4] auditoria_resumen: agregar modulos_activos (count distinct SIN el límite
--       de 20) para que el KPI "Módulos con actividad" no se sature en 20.
-- Idempotente.
-- ============================================================================

set search_path = sgc, public;

-- [1] registrar_version → solo admin.
create or replace function sgc.registrar_version(
  p_plataforma text, p_version text, p_notas text default null
)
returns uuid
language plpgsql
security definer
set search_path to 'sgc', 'pg_temp'
as $function$
declare v_id uuid;
begin
  if not sgc.is_admin() then
    raise exception 'No autorizado.';
  end if;
  if p_plataforma not in ('web', 'movil') then
    raise exception 'plataforma inválida: % (usa web|movil)', p_plataforma;
  end if;
  if coalesce(trim(p_version), '') = '' then
    raise exception 'versión requerida';
  end if;

  insert into sgc.app_versiones (plataforma, version, fecha, notas)
  values (p_plataforma, trim(p_version), current_date, nullif(trim(p_notas), ''))
  on conflict (plataforma, version) do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id from sgc.app_versiones
     where plataforma = p_plataforma and version = trim(p_version);
  end if;

  return v_id;
end;
$function$;
grant execute on function sgc.registrar_version(text, text, text) to authenticated, service_role;

-- [4] auditoria_resumen → + modulos_activos (conteo real, sin cap).
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
    'modulos_activos', (select count(distinct tabla) from base),
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
