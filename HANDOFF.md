# SGC — Session Handoff

_Last updated: 2026-07-07_

## Current focus: Intelligent Context System (Maps + Weather + external context)

A centralized, provider-independent platform service (`src/shared/context/`) that
enriches ERP modules with real-world data. Weather provider = **Open-Meteo**
(keyless, free); maps/geocoding = **Leaflet + OpenStreetMap/Nominatim** (keyless).
All behind swappable boundaries so Google Maps / another weather API can replace
them with **no schema change**.

### ✅ Done

**Phase 1 (commit `9ec7a92`)** — foundation:
- Architecture: `WeatherProvider` interface + `WEATHER_PROVIDER` token +
  `OpenMeteoProvider`; `ContextService` facade; `WeatherService` (30-min TTL cache +
  snapshot persistence); `GeocodingService`; `RecommendationService` (rain/wind/UV/
  heat → construction advice, with `peligro/precaucion/info` levels).
- Components: `weather-card` (current + 7-day + recs), `location-picker` (Leaflet,
  provider-independent `{lat,lng,address}` output).
- DB (`sql/2026-07-07-context-system.sql`, `sql/2026-07-07-bitacora-weather.sql`):
  `proyectos.latitud/longitud/direccion_geo`, `weather_snapshots` history table
  (RLS on), `bitacoras.weather_snapshot_id`, RPC `crear_entrada_bitacora` accepts it.
- Consumers: Proyectos form (picker) + detail (weather card); Bitácora auto-captures
  obra weather on save.

**This session (uncommitted)** — surfacing + interconnection:
- `ProyectosService.getActivasConUbicacion()` — light query of active/in-progress
  projects that have coords.
- `ObrasClimaService` (`src/shared/context/obras-clima.service.ts`) — domain
  aggregator: weather + worst risk level per active obra, sorted worst-first.
- `ObrasClima` component (`src/shared/context/obras-clima/`) — reusable
  `<app-obras-clima />` panel (self-loading grid of per-obra weather + top advisory).
- Wired into **Dashboard** (gated by proyectos/bitácora access) and **Panel de
  Dirección** (panel + climate danger/precaución fed into "Requiere atención").
- Dudas FAQ updated (clima-ubicación: "clima de todas las obras de un vistazo").
- **Also this session:** finished the interrupted **Proyectos → Historial** page
  (route + nav + Dudas + Soporte). Build green.

**Background sync (LIVE in prod):**
- Edge function `supabase/functions/sync-weather-obras/` — snapshots current
  weather for every active obra with coords into `weather_snapshots`. Deployed
  with `--no-verify-jwt`, auth via `x-sync-secret` shared secret (in Supabase
  Vault as `weather_sync_secret` + function env `WEATHER_SYNC_SECRET`).
- **pg_cron** job `weather-sync-obras` runs every 3h (`sql/2026-07-07-weather-cron.sql`).
  Verified end-to-end: net.http_post → function → Open-Meteo → insert (HTTP 200,
  real rows landed for CSD-001 BRISAS CITY CENTER).

**BI weather reports (uncommitted):**
- `WeatherBiService` (`src/shared/context/weather-bi.service.ts`) — aggregates
  `weather_snapshots` into días con lluvia / días adversos (rain ≥0.5mm OR wind
  ≥40km/h) / % adverso per obra.
- `Proyectos > Reportes de clima` page (`src/app/pages/proyectos/clima/`), route
  `/proyectos/clima` + shell nav + Dudas FAQ. 7/30/90-day ranges, tiles, bar chart,
  ranking table. Verified query returns real aggregated data.

### ⏳ Next (pick a batch)

1. **Severe-weather alerts persisted + notification badge** — currently recs are
   computed on-demand only; persist alerts + push to notification system.
2. **Transport/route weather** — Flota/rutas/conduces: weather at destination,
   dispatch-earlier advice.
3. **Architecture doc** (spec deliverable #7) — currently only in-code comments.
4. **Google Maps swap** — only if Xavier provides a billing-enabled API key;
   otherwise OSM stays (recommended).

### Notes / gotchas
- No `supabase/migrations/` dir — SQL lives in `sql/`. Verify migrations actually
  ran against live DB (committed .sql ≠ applied).
- `weather_snapshots` RLS is open read/insert to authenticated — revisit if scoping
  tightens.
- Stale worktree `.claude/worktrees/agent-a52123a0...` (Flota reportes, already on
  main) — safe to `git worktree remove`.
