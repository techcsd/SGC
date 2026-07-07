-- Intelligent Context System — Phase 1 foundation.
-- Provider-independent geolocation + weather so any module can enrich its data
-- with real-world context. We store ONLY latitude/longitude/resolved-address
-- (no provider-specific place ids), and cache weather snapshots so the app
-- doesn't call the weather API on every page load — and so future BI (días
-- perdidos por lluvia, retrasos por clima) has historical data to query.

-- ── Geolocation on proyectos (provider-independent) ──
alter table sgc.proyectos
  add column if not exists latitud   numeric(9, 6),
  add column if not exists longitud  numeric(9, 6),
  add column if not exists direccion_geo text;   -- human-readable address resolved from coords

-- ── Weather snapshots (cache + history) ──
create table sgc.weather_snapshots (
  id                 uuid primary key default gen_random_uuid(),
  proyecto_id        uuid references sgc.proyectos(id) on delete cascade,
  latitud            numeric(9, 6) not null,
  longitud           numeric(9, 6) not null,
  capturado_en       timestamptz not null default now(),
  -- Current-conditions snapshot (construction-relevant fields).
  temperatura        numeric(5, 2),
  sensacion          numeric(5, 2),
  humedad            integer,
  viento_kmh         numeric(6, 2),
  viento_dir         integer,
  precipitacion_mm   numeric(6, 2),
  prob_precipitacion integer,
  nubosidad          integer,
  uv                 numeric(4, 1),
  visibilidad_km     numeric(6, 2),
  codigo_tiempo      integer,           -- WMO weather code
  crudo              jsonb,             -- raw provider payload for extensibility
  constraint weather_snapshots_coords_ok check (latitud between -90 and 90 and longitud between -180 and 180)
);
create index idx_weather_snapshots_proyecto on sgc.weather_snapshots(proyecto_id, capturado_en desc);

alter table sgc.weather_snapshots enable row level security;
-- Weather isn't sensitive; any authenticated user may read/insert snapshots
-- (insert is how a bitácora auto-captures the weather at creation time).
create policy "weather_snapshots: select" on sgc.weather_snapshots for select to authenticated using (true);
create policy "weather_snapshots: insert" on sgc.weather_snapshots for insert to authenticated with check (true);
grant select, insert on sgc.weather_snapshots to authenticated;

-- ── Link a bitácora to the weather captured when it was created ──
alter table sgc.bitacoras
  add column if not exists weather_snapshot_id uuid references sgc.weather_snapshots(id);
