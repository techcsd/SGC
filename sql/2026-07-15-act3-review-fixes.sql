-- ============================================================================
-- Actualización 3 — correcciones de la revisión de código
--   [5] registrar_conteo_app: el overload de 4 args seguía existiendo → una
--       llamada de 4 args quedaba AMBIGUA ("function is not unique"). Se elimina
--       el de 4 args; el de 5 args (p_observaciones default null) cubre a los
--       llamadores viejos de 4 args (retrocompatible de verdad).
--   [3] version_publicada(): ordenar por SEMVER del string de versión, no por
--       version_code — así no se mezclan escalas (versionCode Android chico vs
--       semver derivado ~1e6). El string de versión es la fuente de verdad para
--       "cuál es la mayor". version_code se sigue devolviendo para el cliente.
--   [4] (por diseño) para hacer rollback a una versión anterior, DESPUBLICA la
--       versión nueva mala: la mayor semver AÚN publicada pasa a ser la vigente.
-- Idempotente.
-- ============================================================================

set search_path = sgc, public;

-- [5] Eliminar el overload viejo de 4 args (deja solo el de 5 con default).
drop function if exists sgc.registrar_conteo_app(uuid, uuid, text, jsonb);

-- [3] Selección por semver del string de versión (no por version_code).
create or replace function sgc.version_publicada()
returns jsonb
language sql
stable
security definer
set search_path to 'sgc', 'pg_temp'
as $$
  with pub as (
    select version, notas, apk_url,
           coalesce(version_code, sgc.semver_code(version)) as vcode
    from sgc.app_versiones
    where publicada and plataforma = 'movil'
    order by sgc.semver_code(version) desc
    limit 1
  ),
  mn as (
    select version,
           coalesce(version_code, sgc.semver_code(version)) as vcode
    from sgc.app_versiones
    where minima and plataforma = 'movil'
    order by sgc.semver_code(version) desc
    limit 1
  )
  select jsonb_build_object(
    'version_publicada',    (select version from pub),
    'version_code',         (select vcode   from pub),
    'notas',                (select notas   from pub),
    'apk_url',              (select apk_url from pub),
    'version_minima',       (select version from mn),
    'version_minima_code',  (select vcode   from mn)
  );
$$;
grant execute on function sgc.version_publicada() to authenticated, service_role;
