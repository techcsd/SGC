-- ============================================================================
-- Mejoras 14/07/2026 — R15 Versionado por etapas (staged rollout)
-- ----------------------------------------------------------------------------
-- La versión que se OFRECE a los usuarios es independiente de la versión en
-- desarrollo. El admin decide cuál se publica y cuál es la mínima obligatoria.
--   sgc.app_versiones + RPC público sgc.version_publicada()
-- ============================================================================

set search_path = sgc, public;

create table if not exists sgc.app_versiones (
  id            uuid primary key default gen_random_uuid(),
  version       text not null,
  notas         text,
  apk_url       text,
  publicada     boolean not null default false,
  minima        boolean not null default false,
  created_at    timestamptz not null default now(),
  publicada_at  timestamptz,
  publicada_por uuid references sgc.usuarios(id)
);
create index if not exists idx_app_versiones_pub on sgc.app_versiones(publicada) where publicada;

alter table sgc.app_versiones enable row level security;
-- Lectura para todo usuario autenticado (la app consulta la versión publicada).
drop policy if exists app_versiones_sel on sgc.app_versiones;
create policy app_versiones_sel on sgc.app_versiones for select to authenticated using (true);
-- Escritura sólo admin.
drop policy if exists app_versiones_all on sgc.app_versiones;
create policy app_versiones_all on sgc.app_versiones for all to authenticated
  using (sgc.is_admin()) with check (sgc.is_admin());

grant usage on schema sgc to authenticated;
grant select, insert, update, delete on sgc.app_versiones to authenticated;
grant all on sgc.app_versiones to service_role;

-- RPC público: versión publicada actual + versión mínima obligatoria.
create or replace function sgc.version_publicada()
returns jsonb
language sql
stable
security definer
set search_path to 'sgc','pg_temp'
as $$
  select jsonb_build_object(
    'version_publicada', (select version from sgc.app_versiones where publicada
                            order by coalesce(publicada_at, created_at) desc limit 1),
    'notas',             (select notas   from sgc.app_versiones where publicada
                            order by coalesce(publicada_at, created_at) desc limit 1),
    'apk_url',           (select apk_url from sgc.app_versiones where publicada
                            order by coalesce(publicada_at, created_at) desc limit 1),
    'version_minima',    (select version from sgc.app_versiones where minima
                            order by coalesce(publicada_at, created_at) desc limit 1)
  );
$$;
grant execute on function sgc.version_publicada() to authenticated, service_role;
