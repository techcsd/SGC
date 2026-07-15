-- ============================================================================
-- Actualización 3 — V1/V2/V3: versionado semver real + version_code + apk_url
-- ----------------------------------------------------------------------------
-- Diagnóstico V1: la publicación SÍ persiste en la BD y version_publicada()
-- SÍ refleja el cambio (verificado en prod). El síntoma "no cambia nada en la
-- sección de csd app" es del consumo en el móvil (V2: comparaba versiones como
-- STRING, no semver → 1.10.0 < 1.9.0). Aquí endurecemos el lado BD para que:
--   1) exista version_code numérico (comparación fiable por cualquier consumidor),
--   2) version_publicada() elija por SEMVER real (no por publicada_at/created_at),
--      así publicar una versión de mayor número siempre gana aunque haya varias
--      publicadas o el reloj no ayude,
--   3) el RPC devuelva apk_url + version_code + version_minima_code.
-- Todo aditivo, retrocompatible (mismas claves jsonb + nuevas).
-- ============================================================================

set search_path = sgc, public;

-- 1) Helper semver → entero comparable (major*1e6 + minor*1e3 + patch).
--    Tolera prefijos/sufijos ("v1.4.0", "1.4.0-rc1"): limpia a [0-9.].
create or replace function sgc.semver_code(p_version text)
returns bigint
language plpgsql
immutable
as $$
declare
  v    text := regexp_replace(coalesce(p_version, ''), '[^0-9.]', '', 'g');
  maj  int  := coalesce(nullif(split_part(v, '.', 1), '')::int, 0);
  minr int  := coalesce(nullif(split_part(v, '.', 2), '')::int, 0);
  pat  int  := coalesce(nullif(split_part(v, '.', 3), '')::int, 0);
begin
  return maj::bigint * 1000000 + minr::bigint * 1000 + pat::bigint;
end;
$$;
grant execute on function sgc.semver_code(text) to authenticated, service_role;

-- 2) Columna version_code (Android versionCode real o derivado del semver).
alter table sgc.app_versiones add column if not exists version_code bigint;

-- Backfill de las filas existentes desde su semver.
update sgc.app_versiones
set version_code = sgc.semver_code(version)
where version_code is null;

-- Trigger: mantener version_code coherente (si no lo fija el que inserta/edita,
-- se deriva del semver; si lo fija a mano — p.ej. el build Android — se respeta).
create or replace function sgc.tg_app_versiones_code()
returns trigger
language plpgsql
as $$
begin
  if new.version_code is null then
    new.version_code := sgc.semver_code(new.version);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_app_versiones_code on sgc.app_versiones;
create trigger trg_app_versiones_code
  before insert or update of version, version_code on sgc.app_versiones
  for each row execute function sgc.tg_app_versiones_code();

-- 3) version_publicada(): selección por SEMVER real (version_code desc), no por
--    publicada_at. Devuelve también apk_url, version_code y version_minima_code.
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
    order by coalesce(version_code, sgc.semver_code(version)) desc
    limit 1
  ),
  mn as (
    select version,
           coalesce(version_code, sgc.semver_code(version)) as vcode
    from sgc.app_versiones
    where minima and plataforma = 'movil'
    order by coalesce(version_code, sgc.semver_code(version)) desc
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
