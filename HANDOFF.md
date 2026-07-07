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

**Severe-weather alerts (LIVE in prod):**
- Table `sgc.weather_alerts` (`sql/2026-07-07-weather-alerts.sql`): self-healing
  alert set, `vigente=true` = active severe condition. RLS authenticated-select;
  added to `supabase_realtime` publication.
- Edge fn `sync-weather-obras` now also detects severe conditions (storm /
  lluvia_intensa ≥4mm / viento_fuerte ≥40km/h / calor_extremo ≥38°C, env-tunable
  ALERT_* vars) and maintains alerts: opens new, dedups, resolves cleared.
  Verified end-to-end (open + dedup + resolve) in prod.
- Frontend: badge on Proyectos nav (`NotificacionesService.loadWeatherAlertas`,
  key `proyectos`), realtime toast (`RealtimeNotificacionesService` rt-weather-alerts
  → /proyectos/clima), and "Alertas activas" list on the Reportes de clima page
  (`WeatherAlertsService`). Dudas FAQ updated.

**Transport/route weather (uncommitted):**
- `sgc.rutas` + `destino_lat`/`destino_lng`/`destino_proyecto_id`
  (`sql/2026-07-07-rutas-destino-coords.sql`). `Ruta`/`RutaFormData` extended +
  `destinoCoords()` helper (obra coords win over explicit point).
- `RutasClimaService` — trip-day forecast for a destination + dispatch advisory
  (storm / lluvia ≥60% / viento ≥40km/h).
- Rutas form: "Obra de destino" select OR map picker (app-location-picker), live
  `app-weather-card` for the destination + dispatch advisory for the trip date.
- Rutas list: weather chip on upcoming trips with adverse destination weather.
- Dudas FAQ updated. Verified: build green + PostgREST embed hint resolves.

**Architecture doc:** `docs/intelligent-context-system.md` (spec deliverable #7) —
vision, components, data model, flows, ops, extensibility, decisions, roadmap.

**Air quality (LIVE):** `air-quality.model.ts` + `AirQualityProvider`/`AIR_QUALITY_PROVIDER`
+ `OpenMeteoAirProvider` (keyless) + `AirQualityService` (30-min cache), folded into
`ContextService.getContexto` (parallel fetch; `aire` field + merged air advisories).
Weather-card shows an air-quality row (AQI badge + PM2.5/PM10/dust). Cron edge fn also
detects hazardous air → `aire_peligroso` alert (env `ALERT_AQI`, default 200). Verified
open+resolve lifecycle in prod.

### ⏳ Next (pick a batch)

1. **Traffic** — no keyless provider exists; needs TomTom/HERE/Google key. Plan: edge
   fn proxy (keeps key server-side) + `TrafficProvider` seam + ETA/delay on ruta
   destination. **Awaiting Xavier's choice of provider + key.**
2. **Google Maps swap** — only if Xavier provides a billing-enabled API key.
3. **Sunrise/sunset** (keyless, easy) · **AI assistant** over accumulated context.

### 📌 Pending decision
- 9 commits on local `main` are **NOT pushed** to origin. Pushing likely triggers a
  Vercel prod deploy to sgcconstructorasd.com — awaiting Xavier's go-ahead.

### Notes / gotchas
- No `supabase/migrations/` dir — SQL lives in `sql/`. Verify migrations actually
  ran against live DB (committed .sql ≠ applied).
- `weather_snapshots` RLS is open read/insert to authenticated — revisit if scoping
  tightens.
- Stale worktree `.claude/worktrees/agent-a52123a0...` (Flota reportes, already on
  main) — safe to `git worktree remove`.
