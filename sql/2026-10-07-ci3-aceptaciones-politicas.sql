-- 2026-10-07-ci3-aceptaciones-politicas.sql
-- CI3 — Aceptación versionada de Política de Privacidad y Términos (tiendas).
-- Aditivo y retrocompatible. Web y app comparten estos RPCs (ver docs/PARIDAD.md).
--   node scripts/apply-migration.mjs sql/2026-10-07-ci3-aceptaciones-politicas.sql --env dev

-- ── Tabla ──────────────────────────────────────────────────────────────────────
create table if not exists sgc.aceptaciones_politicas (
  id          uuid primary key default gen_random_uuid(),
  usuario_id  uuid not null references sgc.usuarios(id) on delete cascade,
  documento   text not null check (documento in ('privacidad','terminos')),
  version     text not null,
  plataforma  text,
  aceptada_at timestamptz not null default now()
);
create unique index if not exists aceptaciones_politicas_uq
  on sgc.aceptaciones_politicas (usuario_id, documento, version);
comment on table sgc.aceptaciones_politicas is
  'CI3 — registro de aceptación de privacidad/términos por versión (prueba para tiendas y Ley 172-13).';

-- ── RLS ────────────────────────────────────────────────────────────────────────
alter table sgc.aceptaciones_politicas enable row level security;

drop policy if exists aceptaciones_politicas_sel on sgc.aceptaciones_politicas;
create policy aceptaciones_politicas_sel on sgc.aceptaciones_politicas
  for select to authenticated
  using ( usuario_id = auth.uid() or sgc.is_admin() or sgc.es_tecnologia() );

drop policy if exists aceptaciones_politicas_ins on sgc.aceptaciones_politicas;
create policy aceptaciones_politicas_ins on sgc.aceptaciones_politicas
  for insert to authenticated
  with check ( usuario_id = auth.uid() );

grant select, insert on sgc.aceptaciones_politicas to authenticated;
grant all on sgc.aceptaciones_politicas to service_role;

-- ── Parámetros: versión vigente de cada documento ───────────────────────────────
insert into sgc.parametros (clave, valor, descripcion) values
  ('politica_privacidad_version', '2026-10-07', 'CI3 — versión vigente de la Política de Privacidad. Subirla obliga a re-aceptar.'),
  ('terminos_version',            '2026-10-07', 'CI3 — versión vigente de los Términos de Uso. Subirla obliga a re-aceptar.')
on conflict (clave) do nothing;

-- ── RPC: documentos pendientes de aceptar por el usuario actual ──────────────────
create or replace function sgc.politicas_pendientes()
returns table (documento text, version text)
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  with vigentes(documento, version) as (
    values
      ('privacidad', coalesce((select valor from sgc.parametros where clave = 'politica_privacidad_version'), '2026-10-07')),
      ('terminos',   coalesce((select valor from sgc.parametros where clave = 'terminos_version'),            '2026-10-07'))
  )
  select v.documento, v.version
  from vigentes v
  where auth.uid() is not null
    and not exists (
      select 1 from sgc.aceptaciones_politicas a
      where a.usuario_id = auth.uid()
        and a.documento = v.documento
        and a.version = v.version
    );
$$;
grant execute on function sgc.politicas_pendientes() to authenticated;

-- ── RPC: aceptar un documento (idempotente) ──────────────────────────────────────
create or replace function sgc.aceptar_politica(
  p_documento text,
  p_version text,
  p_plataforma text default null
)
returns void
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  if p_documento not in ('privacidad','terminos') then
    raise exception 'documento inválido: %', p_documento;
  end if;
  if coalesce(trim(p_version), '') = '' then
    raise exception 'version requerida';
  end if;
  insert into sgc.aceptaciones_politicas (usuario_id, documento, version, plataforma)
  values (v_uid, p_documento, p_version, nullif(trim(p_plataforma), ''))
  on conflict (usuario_id, documento, version) do nothing;
end;
$$;
grant execute on function sgc.aceptar_politica(text, text, text) to authenticated;
