-- ============================================================================
-- CD2 (nota #93) — "Auditoría": los filtros no funcionan + el date picker se ve mal.
--
-- Diagnóstico (prod, 30-sep): el módulo lee OK para admin (RLS + grant presentes,
-- 32 063 filas visibles, índices creado/tabla/actor/accion existen). El bug de los
-- FILTROS es que `auditoria_actores()` REVIENTA con 42804 "structure of query does
-- not match function result type" — declara RETURNS TABLE(..., nombre text) pero
-- usuarios.nombre es varchar(150) (gotcha varchar↔text). Como auditoria.ts carga los
-- filtros con Promise.all([tablas(), actores()]), el fallo de actores() RECHAZA todo
-- el Promise.all → AMBOS selects quedan vacíos ("Todos los usuarios" / "Todas las
-- áreas" sin opciones), y un `catch {}` mudo lo esconde (regla 16).
--
-- Fix: (1) auditoria_actores castea ::text; (2) auditoria_opciones() = UN RPC que
-- trae tablas + actores juntos (definer, gate, cast) → el front no depende de dos
-- llamadas frágiles; (3) auditoria_listar(filtros, offset) definer para la lista
-- (independiente de RLS, cast, con total por window); (4) índices compuestos para
-- filtro+orden. El date picker se arregla en date-range-filter.scss (viewport/z-index).
--
-- Aplicar:  node scripts/apply-migration.mjs sql/2026-09-30-cd2-auditoria-filtros.sql --env dev  →  --env prod
-- ============================================================================
begin;

-- ── 0. Gate reutilizable ────────────────────────────────────────────────────
create or replace function sgc.puede_ver_auditoria()
returns boolean language sql stable security definer set search_path to 'sgc','pg_temp'
as $function$ select sgc.is_admin() or sgc.tiene_modulo('auditoria') or sgc.es_tecnologia(); $function$;
grant execute on function sgc.puede_ver_auditoria() to authenticated;

-- ── 1. Fix del crash: cast ::text ──────────────────────────────────────────
create or replace function sgc.auditoria_actores()
returns table(actor_id uuid, nombre text)
language plpgsql stable security definer set search_path to 'sgc','pg_temp'
as $function$
begin
  if not sgc.puede_ver_auditoria() then raise exception 'No autorizado.'; end if;
  return query
    select distinct a.actor_id, u.nombre::text
    from sgc.auditoria a
    join sgc.usuarios u on u.id = a.actor_id
    where a.actor_id is not null
    order by u.nombre::text;
end;
$function$;
grant execute on function sgc.auditoria_actores() to authenticated;

-- ── 2. Opciones de filtro en UN solo RPC (tablas + actores) ─────────────────
create or replace function sgc.auditoria_opciones()
returns jsonb
language plpgsql stable security definer set search_path to 'sgc','pg_temp'
as $function$
declare v jsonb;
begin
  if not sgc.puede_ver_auditoria() then raise exception 'No autorizado.'; end if;
  select jsonb_build_object(
    'tablas', coalesce((select jsonb_agg(t order by t) from (select distinct tabla::text t from sgc.auditoria where tabla is not null) s), '[]'::jsonb),
    'actores', coalesce((select jsonb_agg(jsonb_build_object('actor_id', a.actor_id, 'nombre', a.nombre) order by a.nombre)
                         from (select distinct au.actor_id, u.nombre::text nombre
                               from sgc.auditoria au join sgc.usuarios u on u.id = au.actor_id
                               where au.actor_id is not null) a), '[]'::jsonb)
  ) into v;
  return v;
end;
$function$;
grant execute on function sgc.auditoria_opciones() to authenticated;

-- ── 3. Lista paginada (definer, cast, total por window) ─────────────────────
create or replace function sgc.auditoria_listar(
  p_tabla  text default null, p_accion text default null, p_actor uuid default null,
  p_desde  date default null, p_hasta  date default null, p_buscar text default null,
  p_limite integer default 40, p_offset integer default 0
) returns setof jsonb
language plpgsql stable security definer set search_path to 'sgc','pg_temp'
as $function$
begin
  if not sgc.puede_ver_auditoria() then raise exception 'No autorizado.'; end if;
  return query
    with filtrado as (
      select a.*
      from sgc.auditoria a
      where (p_tabla  is null or a.tabla = p_tabla)
        and (p_accion is null or a.accion = p_accion)
        and (p_actor  is null or a.actor_id = p_actor)
        and (p_desde  is null or a.creado_en >= p_desde::timestamptz)
        and (p_hasta  is null or a.creado_en < (p_hasta + 1)::timestamptz)
        and (p_buscar is null or p_buscar = '' or
             a.registro_id::text ilike '%'||p_buscar||'%' or a.tabla::text ilike '%'||p_buscar||'%')
    ),
    contado as (select *, count(*) over() as total from filtrado order by creado_en desc limit greatest(1,least(coalesce(p_limite,40),200)) offset greatest(0,coalesce(p_offset,0)))
    select jsonb_build_object(
      'id', c.id, 'tabla', c.tabla, 'registro_id', c.registro_id, 'accion', c.accion,
      'actor_id', c.actor_id, 'impersonado_por', c.impersonado_por,
      'cambios', c.cambios, 'datos_despues', c.datos_despues, 'datos_antes', c.datos_antes,
      'creado_en', c.creado_en, 'total', c.total,
      'actor', case when au.id is not null then jsonb_build_object('nombre', au.nombre::text) else null end,
      'impersonador', case when im.id is not null then jsonb_build_object('nombre', im.nombre::text) else null end
    )
    from contado c
    left join sgc.usuarios au on au.id = c.actor_id
    left join sgc.usuarios im on im.id = c.impersonado_por;
end;
$function$;
grant execute on function sgc.auditoria_listar(text,text,uuid,date,date,text,integer,integer) to authenticated;

-- ── 4. Índices compuestos para filtro + orden ──────────────────────────────
create index if not exists idx_auditoria_tabla_creado on sgc.auditoria (tabla, creado_en desc);
create index if not exists idx_auditoria_actor_creado on sgc.auditoria (actor_id, creado_en desc);
create index if not exists idx_auditoria_accion_creado on sgc.auditoria (accion, creado_en desc);

commit;
