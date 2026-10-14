-- ============================================================================
-- CO1 — PROMPT-98 FASE 4 (14/10/2026)
-- "la pwa esta frizada en la 2.45 y no sube" (#211) — la parte de servidor.
--
-- Hoy `version_publicada()` SOLO conoce `plataforma='movil'`: Android (APK) y la
-- PWA de iPhone comparten la misma fila de "versión publicada/mínima" aunque son
-- releases distintos (un APK puede salir roto y la PWA seguir bien, o viceversa).
-- Esta migración:
--   1) `version_publicada(p_plataforma text default 'movil')` — la app/PWA pasa su
--      plataforma real ('movil' para Android, 'ios-pwa' para la PWA instalada);
--      si no hay fila publicada/mínima para esa plataforma aún (porque nadie la
--      ha creado en Admin › Versiones), cae a 'movil' — CERO regresión hasta que
--      PROMPT-99 empiece a registrar ios-pwa aparte.
--   2) `dispositivos_listado()` — para Sistema › Versiones de la app: por usuario+
--      plataforma+modelo, versión del último reporte, cuándo se vio, y si está
--      ATASCADO (versión < la publicada de SU plataforma, visto hace > 48h;
--      Android además se marca atascado si sigue en 2.44.x/2.45.0, que no tiene
--      arreglo remoto — CL4).
--
-- Aditivo e idempotente. Regla 19: version_publicada recreada sobre la viva.
-- ============================================================================
begin;
set local search_path = sgc, public;

-- Dropea la 0-arg vieja: dejar las dos crea un overload ambiguo para
-- `select sgc.version_publicada()` (gotcha recurrente, regla 19).
drop function if exists sgc.version_publicada();
create or replace function sgc.version_publicada(p_plataforma text default 'movil')
returns jsonb
language sql
stable security definer
set search_path to 'sgc', 'pg_temp'
as $function$
  with plat as (select coalesce(nullif(trim(p_plataforma), ''), 'movil') as p),
  pub as (
    select version, notas, apk_url, coalesce(version_code, sgc.semver_code(version)) as vcode
    from sgc.app_versiones, plat
    where publicada and plataforma = plat.p
    order by sgc.semver_code(version) desc limit 1
  ),
  pub_fallback as (
    select version, notas, apk_url, coalesce(version_code, sgc.semver_code(version)) as vcode
    from sgc.app_versiones
    where publicada and plataforma = 'movil'
    order by sgc.semver_code(version) desc limit 1
  ),
  mn as (
    select version, coalesce(version_code, sgc.semver_code(version)) as vcode
    from sgc.app_versiones, plat
    where minima and plataforma = plat.p
    order by sgc.semver_code(version) desc limit 1
  ),
  mn_fallback as (
    select version, coalesce(version_code, sgc.semver_code(version)) as vcode
    from sgc.app_versiones
    where minima and plataforma = 'movil'
    order by sgc.semver_code(version) desc limit 1
  )
  select jsonb_build_object(
    'version_publicada',   coalesce((select version from pub), (select version from pub_fallback)),
    'version_code',        coalesce((select vcode   from pub), (select vcode   from pub_fallback)),
    'notas',               coalesce((select notas   from pub), (select notas   from pub_fallback)),
    'apk_url',             coalesce((select apk_url from pub), (select apk_url from pub_fallback)),
    'version_minima',      coalesce((select version from mn),  (select version from mn_fallback)),
    'version_minima_code', coalesce((select vcode   from mn),  (select vcode   from mn_fallback))
  );
$function$;
grant execute on function sgc.version_publicada(text) to anon, authenticated;

create or replace function sgc.dispositivos_listado()
returns table(
  usuario_id uuid, usuario_nombre text, plataforma text, modelo text, app_version text,
  visto_at timestamptz, primer_uso timestamptz, atascado boolean
)
language plpgsql
stable security definer
set search_path to 'sgc', 'pg_temp'
as $function$
begin
  if not sgc.es_tecnologia() then
    raise exception 'No autorizado para ver dispositivos.' using errcode = '42501';
  end if;
  return query
  select d.usuario_id, u.nombre::text, d.plataforma, d.modelo, d.app_version, d.visto_at, d.primer_uso,
    coalesce(
      -- Android: 2.44.x/2.45.0 no se arregla solo (CL4) — siempre atascado.
      (d.plataforma = 'android' and sgc.semver_key(d.app_version) < sgc.semver_key('2.46.0')), false
    ) or coalesce(
      -- Cualquier plataforma: versión vieja + > 48h sin verse, contra la publicada DE SU plataforma
      -- (o la de 'movil' si esa plataforma específica aún no tiene fila propia, CO1).
      (
        d.visto_at < now() - interval '48 hours'
        and sgc.semver_key(d.app_version) < (
          select max(sgc.semver_key(av.version))
          from sgc.app_versiones av
          where av.publicada and av.plataforma = (
            case when exists(select 1 from sgc.app_versiones av2 where av2.plataforma = d.plataforma)
                 then d.plataforma else 'movil' end
          )
        )
      ), false
    ) as atascado
  from sgc.usuario_dispositivos d
  join sgc.usuarios u on u.id = d.usuario_id
  order by d.visto_at desc;
end;
$function$;
grant execute on function sgc.dispositivos_listado() to authenticated;

commit;
