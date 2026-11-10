-- =============================================================================
-- DL5 (ronda DL, 10-nov-2026) — Compa en WhatsApp: recap diario/semanal con
-- PDF por correo. Reemplaza las tareas 'resumenes_dia'/'resumenes_semana' de
-- `wa-extract` (cron con ventana UTC rota — CONTEXTO §2.5) por una edge nueva
-- `wa-recap` con cursor rodante por grupo en hora America/Santo_Domingo.
--
-- Aditivo, idempotente. Depende de sql/2026-11-05-db2-whatsapp-grupos.sql y
-- sql/2026-11-10-dl3-wa-seguimiento.sql (envios_automaticos/notif_tipo ya
-- sembrados ahí).
--
-- Apply: node scripts/apply-migration.mjs sql/2026-11-10-dl5-wa-recap.sql --env dev
-- =============================================================================
begin;
set local search_path = sgc, public;

-- ── 1) sgc.wa_resumenes — contenido ampliado (DL-20) ────────────────────────
alter table sgc.wa_resumenes
  add column if not exists desde timestamptz,
  add column if not exists hasta timestamptz,
  add column if not exists decisiones jsonb not null default '[]'::jsonb,
  add column if not exists pendientes jsonb not null default '[]'::jsonb,
  add column if not exists pdf_path text;
comment on table sgc.wa_resumenes is
  'DB2/DL5 — resumen diario/semanal por grupo. desde/hasta = ventana real cubierta (cursor rodante, hora RD). decisiones/pendientes = listas estructuradas para el PDF del recap. pdf_path = objeto en el bucket wa-recaps de la ÚLTIMA persona para la que se generó (referencia informativa; cada destinatario tiene su propio PDF en wa_recap_envios).';

-- ── 2) Cursor rodante por grupo/periodo (DL-17) ─────────────────────────────
create table if not exists sgc.wa_recap_cursor (
  grupo_jid text not null references sgc.wa_grupos(jid) on delete cascade,
  periodo   text not null check (periodo in ('dia','semana')),
  hasta     timestamptz not null,
  primary key (grupo_jid, periodo)
);
comment on table sgc.wa_recap_cursor is
  'DL5/DL-17 — hasta dónde se cubrió el último recap de este grupo/periodo. La próxima corrida cubre [hasta, ahora). Reemplaza la ventana fija por días calendario de wa-extract (ventana UTC rota, CONTEXTO §2.5).';
alter table sgc.wa_recap_cursor enable row level security;
grant all on sgc.wa_recap_cursor to service_role;
-- Sin policy de select a authenticated a propósito: es estado interno de la
-- edge, no un dato que la pantalla necesite mostrar (se infiere de wa_resumenes.hasta).

-- ── 3) Destinatarios del recap por grupo (DL-21) ────────────────────────────
create table if not exists sgc.wa_grupo_destinatarios (
  grupo_jid    text not null references sgc.wa_grupos(jid) on delete cascade,
  usuario_id   uuid not null references sgc.usuarios(id) on delete cascade,
  recap_dia    boolean not null default true,
  recap_semana boolean not null default true,
  primary key (grupo_jid, usuario_id)
);
comment on table sgc.wa_grupo_destinatarios is
  'DL5/DL-21 — quién recibe el PDF de recap de cada grupo (diario/semanal, por separado). Default: solo Tecnología (sembrado abajo); Xaviel añade más desde la pantalla.';
alter table sgc.wa_grupo_destinatarios enable row level security;
drop policy if exists wa_grupo_destinatarios_sel on sgc.wa_grupo_destinatarios;
create policy wa_grupo_destinatarios_sel on sgc.wa_grupo_destinatarios for select to authenticated
  using (sgc.puede_ver_submodulo('tecnologia.wa_grupos'));
grant select on sgc.wa_grupo_destinatarios to authenticated;
grant all on sgc.wa_grupo_destinatarios to service_role;

create or replace function sgc.wa_grupo_destinatarios_set(p_grupo text, p_usuarios jsonb)
returns void
language plpgsql security definer set search_path to 'sgc', 'pg_temp'
as $$
begin
  if not sgc.puede_operar_submodulo('tecnologia.wa_grupos') then
    raise exception 'No autorizado.' using errcode = '42501';
  end if;
  delete from sgc.wa_grupo_destinatarios where grupo_jid = p_grupo;
  insert into sgc.wa_grupo_destinatarios (grupo_jid, usuario_id, recap_dia, recap_semana)
  select p_grupo,
    (item->>'usuario_id')::uuid,
    coalesce((item->>'recap_dia')::boolean, true),
    coalesce((item->>'recap_semana')::boolean, true)
  from jsonb_array_elements(coalesce(p_usuarios, '[]'::jsonb)) as item
  where item->>'usuario_id' is not null
  on conflict (grupo_jid, usuario_id) do update
    set recap_dia = excluded.recap_dia, recap_semana = excluded.recap_semana;
end;
$$;
grant execute on function sgc.wa_grupo_destinatarios_set(text, jsonb) to authenticated;

-- Siembra: Tecnología por cada grupo existente (DL-21 default — "Solo yo").
insert into sgc.wa_grupo_destinatarios (grupo_jid, usuario_id)
select g.jid, u.id
from sgc.wa_grupos g
cross join (
  select id from sgc.usuarios where lower(email) = lower('Tecnologia@constructorasd.com') and activo limit 1
) u
on conflict (grupo_jid, usuario_id) do nothing;

-- ── 4) Log de envíos de recap (DL5) ──────────────────────────────────────────
create table if not exists sgc.wa_recap_envios (
  id         uuid primary key default gen_random_uuid(),
  periodo    text not null check (periodo in ('dia','semana')),
  desde      timestamptz not null,
  hasta      timestamptz not null,
  usuario_id uuid references sgc.usuarios(id) on delete set null,
  grupos     text[] not null default '{}',
  estado     text not null check (estado in ('enviado','omitido_sin_actividad','sin_destinatarios','fallido','prueba')),
  motivo     text,
  pdf_path   text,
  creado_en  timestamptz not null default now()
);
comment on table sgc.wa_recap_envios is 'DL5 — un registro por correo de recap efectivamente enviado (o por qué no).';
alter table sgc.wa_recap_envios enable row level security;
drop policy if exists wa_recap_envios_sel on sgc.wa_recap_envios;
create policy wa_recap_envios_sel on sgc.wa_recap_envios for select to authenticated
  using (sgc.puede_ver_submodulo('tecnologia.wa_grupos'));
grant select on sgc.wa_recap_envios to authenticated;
grant all on sgc.wa_recap_envios to service_role;
create index if not exists idx_wa_recap_envios_creado on sgc.wa_recap_envios (creado_en desc);

-- ── 5) Bucket privado de PDFs (solo service_role, como wa-media) ────────────
insert into storage.buckets (id, name, public, file_size_limit)
  values ('wa-recaps', 'wa-recaps', false, 10485760) -- 10 MB
  on conflict (id) do nothing;

-- ── 6) Lectura paginada para la pantalla (pestaña Resúmenes) ────────────────
create or replace function sgc.wa_recap_listar(
  p_periodo text default null, p_grupo text default null,
  p_desde date default null, p_hasta date default null,
  p_limit integer default 50, p_offset integer default 0
) returns table (
  id uuid, grupo_jid text, grupo_nombre text, periodo text, fecha date,
  desde timestamptz, hasta timestamptz, resumen text, decisiones jsonb, pendientes jsonb,
  mensajes_cubiertos integer, pdf_path text, creado_en timestamptz, total bigint
)
language sql stable security definer set search_path to 'sgc', 'pg_temp'
as $$
  select r.id, r.grupo_jid, g.nombre, r.periodo, r.fecha, r.desde, r.hasta, r.resumen,
    r.decisiones, r.pendientes, r.mensajes_cubiertos, r.pdf_path, r.creado_en,
    count(*) over () as total
  from sgc.wa_resumenes r
  join sgc.wa_grupos g on g.jid = r.grupo_jid
  where sgc.puede_ver_submodulo('tecnologia.wa_grupos')
    and (p_periodo is null or r.periodo = p_periodo)
    and (p_grupo is null or r.grupo_jid = p_grupo)
    and (p_desde is null or r.fecha >= p_desde)
    and (p_hasta is null or r.fecha <= p_hasta)
  order by r.fecha desc, g.nombre
  limit greatest(1, least(coalesce(p_limit,50), 200))
  offset greatest(0, coalesce(p_offset,0));
$$;
grant execute on function sgc.wa_recap_listar(text,text,date,date,integer,integer) to authenticated, service_role;

-- ── 7) Crons (DL-18) — retira los de wa-extract, agrega los de wa-recap/wa-seguimiento ─
-- Deprecados (se dejan unscheduled; wa-extract sigue respondiendo esas tareas
-- con {ok:true, deprecado:true} un ciclo antes de borrarlas del código).
do $$ begin perform cron.unschedule('sgc-wa-resumenes-diarios'); exception when others then null; end $$;
do $$ begin perform cron.unschedule('sgc-wa-resumenes-semanales'); exception when others then null; end $$;

-- Diario 6:00pm RD (L-S) = 22:00 UTC (RD = UTC-4 todo el año, sin horario de verano).
do $$ begin perform cron.unschedule('sgc-wa-recap-diario'); exception when others then null; end $$;
select cron.schedule('sgc-wa-recap-diario', '0 22 * * 1-6', $cron$
  select net.http_post(
    url := sgc.edge_url('wa-recap'),
    headers := jsonb_build_object('Content-Type','application/json',
      'x-sync-secret', (select decrypted_secret from vault.decrypted_secrets where name='infra_sync_secret')),
    body := '{"tarea":"dia"}'::jsonb)
$cron$);

-- Semanal sábado 6:30pm RD = 22:30 UTC sábado.
do $$ begin perform cron.unschedule('sgc-wa-recap-semanal'); exception when others then null; end $$;
select cron.schedule('sgc-wa-recap-semanal', '30 22 * * 6', $cron$
  select net.http_post(
    url := sgc.edge_url('wa-recap'),
    headers := jsonb_build_object('Content-Type','application/json',
      'x-sync-secret', (select decrypted_secret from vault.decrypted_secrets where name='infra_sync_secret')),
    body := '{"tarea":"semana"}'::jsonb)
$cron$);

-- Recordatorios 7:00am RD (L-S) = 11:00 UTC (DL-12).
do $$ begin perform cron.unschedule('sgc-wa-seguimiento'); exception when others then null; end $$;
select cron.schedule('sgc-wa-seguimiento', '0 11 * * 1-6', $cron$
  select net.http_post(
    url := sgc.edge_url('wa-seguimiento'),
    headers := jsonb_build_object('Content-Type','application/json',
      'x-sync-secret', (select decrypted_secret from vault.decrypted_secrets where name='infra_sync_secret')),
    body := '{}'::jsonb)
$cron$);

commit;
