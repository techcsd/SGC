-- =============================================================================
-- PROMPT-28 (BG) FASE 3 — BG1(c): señal "corregido" para el outbox.
-- Ronda 19/08-03/09/2026. Aditivo, idempotente, retrocompatible.
--
-- Cuando Tecnología publica el fix de un error de SISTEMA (RLS/constraint/bug), la
-- app necesita saberlo para SUGERIR el reintento de los pendientes de esa clase
-- ("Hay una actualización que puede resolver tus 3 pendientes — ¿reintentar?").
-- Este es el canal servidor→app de esa señal: Tecnología marca el fix publicado;
-- la app lo consulta y, si un pendiente de categoría 'sistema' coincide (tipo_op /
-- error_code) y la versión de la app es >= la mínima, sugiere el reintento.
--
-- ⚠️ Xaviel decide en PROMPT-29 si el reintento es SUGERIDO o AUTOMÁTICO (una vez
-- por versión). Este contrato sirve a ambos: la app lee la señal y actúa según esa
-- decisión.
--
-- Un solo camino (AU1): la señal la publica Tecnología por RPC gateado; la app la
-- lee por RPC de solo-lectura. Sin grants de tabla sueltos.
--
-- Apply: node scratchpad/apply-sql.mjs sql/2026-09-01-bg1-outbox-fix-signal.sql
-- =============================================================================
begin;

create table if not exists sgc.outbox_fix_publicado (
  id              uuid primary key default gen_random_uuid(),
  tipo_op         text,          -- null = aplica a todos los tipos del outbox
  error_code      text,          -- null = cualquier SQLSTATE (p.ej. '42501','23514','22001')
  min_app_version text,          -- null = cualquier versión; si no, la app sugiere solo si version >=
  descripcion     text not null, -- qué se arregló (visible para el usuario en la sugerencia)
  activo          boolean not null default true,
  publicado_por   uuid references sgc.usuarios(id),
  publicado_en    timestamptz not null default now()
);
create index if not exists idx_outbox_fix_activo
  on sgc.outbox_fix_publicado (activo, publicado_en desc);

alter table sgc.outbox_fix_publicado enable row level security;

-- Lectura: cualquier usuario autenticado (la app la consulta para sugerir reintento).
drop policy if exists outbox_fix_select on sgc.outbox_fix_publicado;
create policy outbox_fix_select on sgc.outbox_fix_publicado
  for select to authenticated using (true);

-- Escritura: solo por RPC DEFINER gateado (no política directa).

-- ── Publicar un fix (Tecnología, al deployar la corrección) ──────────────────
create or replace function sgc.publicar_fix_outbox(
  p_descripcion text,
  p_tipo_op text default null,
  p_error_code text default null,
  p_min_app_version text default null
) returns uuid
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare v_id uuid;
begin
  if not sgc.es_tecnologia() then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  if coalesce(trim(p_descripcion),'') = '' then
    raise exception 'La descripción del fix es obligatoria.';
  end if;
  insert into sgc.outbox_fix_publicado
    (tipo_op, error_code, min_app_version, descripcion, publicado_por)
  values
    (nullif(trim(p_tipo_op),''), nullif(trim(p_error_code),''),
     nullif(trim(p_min_app_version),''), trim(p_descripcion), auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;
grant execute on function sgc.publicar_fix_outbox(text, text, text, text)
  to authenticated, service_role;

-- ── Fixes activos (lo consulta la app) ───────────────────────────────────────
create or replace function sgc.outbox_fixes_activos()
returns table (
  id uuid, tipo_op text, error_code text, min_app_version text,
  descripcion text, publicado_en timestamptz
)
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select id, tipo_op, error_code, min_app_version, descripcion, publicado_en
  from sgc.outbox_fix_publicado
  where activo
  order by publicado_en desc
  limit 100;
$$;
grant execute on function sgc.outbox_fixes_activos() to authenticated, service_role;

-- ── Desactivar un fix ya obsoleto (Tecnología) ───────────────────────────────
create or replace function sgc.desactivar_fix_outbox(p_id uuid)
returns void
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $$
begin
  if not sgc.es_tecnologia() then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  update sgc.outbox_fix_publicado set activo = false where id = p_id;
end;
$$;
grant execute on function sgc.desactivar_fix_outbox(uuid) to authenticated, service_role;

commit;
