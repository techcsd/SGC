-- ─────────────────────────────────────────────────────────────────────────────
-- Intelligent Context System — persisted severe-weather alerts
--
-- The sync-weather-obras edge function evaluates each obra's current conditions
-- and maintains a self-healing set of alerts here: it opens an alert when a
-- severe (peligro-level) condition appears and resolves it (vigente=false) when
-- the condition clears. "vigente" alerts = severe weather happening right now,
-- which drives the notification badge and avisos.
--
-- One alert row per (proyecto, tipo) while the condition persists — no spam.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists sgc.weather_alerts (
  id           uuid primary key default gen_random_uuid(),
  proyecto_id  uuid not null references sgc.proyectos(id) on delete cascade,
  snapshot_id  uuid references sgc.weather_snapshots(id) on delete set null,
  tipo         text not null,   -- tormenta | lluvia_intensa | viento_fuerte | calor_extremo
  nivel        text not null default 'peligro' check (nivel in ('peligro', 'precaucion')),
  titulo       text not null,
  detalle      text not null,
  vigente      boolean not null default true,
  creado_en    timestamptz not null default now(),
  resuelto_en  timestamptz
);

-- Fast lookups: active alerts (badge) and per-obra open alert per tipo (dedup).
create index if not exists weather_alerts_vigente_idx
  on sgc.weather_alerts (vigente, creado_en desc);
create index if not exists weather_alerts_obra_tipo_idx
  on sgc.weather_alerts (proyecto_id, tipo, vigente);

alter table sgc.weather_alerts enable row level security;

-- Any authenticated user can read alerts (they're operational, not sensitive).
-- Writes happen only from the edge function via service_role (bypasses RLS).
drop policy if exists weather_alerts_select on sgc.weather_alerts;
create policy weather_alerts_select on sgc.weather_alerts
  for select to authenticated using (true);

grant select on sgc.weather_alerts to authenticated;

-- Realtime: push new alerts to subscribed clients (drives the toast / aviso).
-- Mirrors sql/2026-07-07-realtime-publications.sql.
alter publication supabase_realtime add table sgc.weather_alerts;
