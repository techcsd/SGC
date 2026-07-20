-- ============================================================================
-- Historial de versiones con link a esa versión (20/07/2026)
-- ----------------------------------------------------------------------------
-- Regla permanente: cada versión web del historial (sgc.app_versiones) lleva su
-- link a esa versión (commit de GitHub) en la columna `url`.
--
-- Migración ADITIVA y RETROCOMPATIBLE: `registrar_version` acepta `p_url` con
-- DEFAULT null (las llamadas viejas de 5 args siguen resolviendo). Idempotente:
-- solo RELLENA el url si está vacío (nunca sobrescribe uno ya puesto).
-- La columna `url` ya existe en la tabla.
-- ============================================================================

set search_path = sgc, public;

create or replace function sgc.registrar_version(
  p_plataforma text,
  p_version text,
  p_notas text default null,
  p_titulo text default null,
  p_cambios jsonb default null,
  p_url text default null
) returns uuid
language plpgsql
security definer
set search_path to 'sgc','pg_temp'
as $function$
declare v_id uuid;
begin
  if not (sgc.is_admin() or coalesce((select auth.role()), '') = 'service_role') then
    raise exception 'No autorizado.';
  end if;
  if p_plataforma not in ('web', 'movil') then
    raise exception 'plataforma inválida: % (usa web|movil)', p_plataforma;
  end if;
  if coalesce(trim(p_version), '') = '' then
    raise exception 'versión requerida';
  end if;

  insert into sgc.app_versiones (plataforma, version, fecha, notas, titulo, cambios, url)
  values (
    p_plataforma, trim(p_version), current_date,
    nullif(trim(p_notas), ''),
    nullif(trim(p_titulo), ''),
    case when p_cambios is not null and jsonb_typeof(p_cambios) = 'array'
         then p_cambios else '[]'::jsonb end,
    nullif(trim(p_url), '')
  )
  -- Idempotente + enriquecedor: solo RELLENA lo vacío, nunca sobrescribe lo que
  -- ya tenga contenido (p.ej. notas editadas por un admin desde la web).
  on conflict (plataforma, version) do update set
    titulo  = coalesce(sgc.app_versiones.titulo, excluded.titulo),
    notas   = coalesce(sgc.app_versiones.notas,  excluded.notas),
    cambios = case when coalesce(jsonb_array_length(sgc.app_versiones.cambios), 0) = 0
                   then excluded.cambios else sgc.app_versiones.cambios end,
    url     = coalesce(sgc.app_versiones.url, excluded.url),
    fecha   = coalesce(sgc.app_versiones.fecha, excluded.fecha)
  returning id into v_id;

  return v_id;
end;
$function$;
grant execute on function sgc.registrar_version(text, text, text, text, jsonb, text) to authenticated, service_role;

-- ── Backfill: link al commit de GitHub de las versiones web ya registradas ──
-- (solo donde el commit es determinable por el historial de git; no pisa urls
--  ya puestas.)
update sgc.app_versiones set url = 'https://github.com/techcsd/SGC/commit/25f8546' where plataforma='web' and version in ('1.16.0','1.15.0') and url is null;
update sgc.app_versiones set url = 'https://github.com/techcsd/SGC/commit/92274b2' where plataforma='web' and version = '1.14.1' and url is null;
update sgc.app_versiones set url = 'https://github.com/techcsd/SGC/commit/b2a0c85' where plataforma='web' and version = '1.14.0' and url is null;
update sgc.app_versiones set url = 'https://github.com/techcsd/SGC/commit/301dcb2' where plataforma='web' and version = '1.13.0' and url is null;
update sgc.app_versiones set url = 'https://github.com/techcsd/SGC/commit/ea8d8eb' where plataforma='web' and version = '1.12.0' and url is null;
