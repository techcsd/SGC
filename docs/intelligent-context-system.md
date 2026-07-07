# Intelligent Context System — Architecture

_SGC (Sistema de Gestión de Constructora SD) · last updated 2026-07-07_

The Intelligent Context System is a **centralized, provider-independent platform
service** that enriches ERP modules with real-world context (weather today; traffic,
air quality, etc. tomorrow). Modules never call Google Maps / a weather API
directly — they ask the Context System, so the provider can change without touching
business logic.

```
Module (Proyectos, Bitácora, Flota, Dashboard, Dirección)
      │
      ▼
ContextService ──────────── facade (single entry point)
      ├── WeatherService ────── WEATHER_PROVIDER (OpenMeteoProvider)       ← swappable
      ├── AirQualityService ─── AIR_QUALITY_PROVIDER (OpenMeteoAirProvider) ← swappable
      ├── RecommendationService (pure rules → weather + air advice)
      └── GeocodingService (Nominatim; reverse/forward)

Domain aggregators (combine Context + domain data):
      ├── ObrasClimaService     → weather across active obras
      ├── RutasClimaService     → weather at a route destination
      ├── WeatherBiService      → weather-impact BI over history
      └── WeatherAlertsService  → active severe-weather alerts

Background: pg_cron (3h) → edge fn sync-weather-obras → weather_snapshots + weather_alerts
```

## Design principles

1. **Provider independence.** The DB stores only latitude/longitude and normalized
   weather fields — never provider IDs. Providers implement a `WeatherProvider`
   interface behind the `WEATHER_PROVIDER` injection token. Maps/geocoding are
   isolated in the `location-picker` component + `GeocodingService`, whose only
   output is `{lat, lng, address}`. Swapping to Google Maps = rewrite one file +
   add a key; nothing else changes.
2. **Facade over sources.** Consumers depend on `ContextService`, not on individual
   weather/maps services, so new context sources plug in without changing consumers.
3. **Thin domain aggregators.** Cross-domain logic (weather across obras, weather at
   a route destination, BI) lives in small dedicated services that combine
   `ContextService` with domain services — keeping `ContextService` generic.
4. **Keyless & free by default.** Open-Meteo (weather) and OpenStreetMap/Nominatim
   (maps/geocoding) need no API key or billing — nothing blocks on secrets.

## Core building blocks (`src/shared/context/`)

| File | Responsibility |
|------|----------------|
| `weather.model.ts` | Provider-independent domain shapes (`WeatherActual/Hora/Dia/Pronostico`, `Recomendacion`, `RiesgoNivel`) + WMO code interpretation. |
| `weather-provider.ts` | `WeatherProvider` interface + `WEATHER_PROVIDER` token. |
| `open-meteo.provider.ts` | Concrete weather provider (Open-Meteo). Maps raw payload → domain models. |
| `weather.service.ts` | Fetch-through **30-min TTL cache** + snapshot persistence. |
| `air-quality.model.ts` | Provider-independent `CalidadAire` + US-AQI band interpretation. |
| `air-quality-provider.ts` | `AirQualityProvider` interface + `AIR_QUALITY_PROVIDER` token. |
| `open-meteo-air.provider.ts` | Concrete air-quality provider (Open-Meteo Air Quality; keyless). |
| `air-quality.service.ts` | Fetch-through 30-min TTL cache for air quality. |
| `recommendation.service.ts` | Pure rules: rain/wind/UV/heat + air (AQI/PM/dust) → construction advice. |
| `geocoding.service.ts` | Reverse/forward geocoding (Nominatim, DR-biased). |
| `context.service.ts` | **Facade**: `getContexto(coords)` → weather + recommendations. |
| `location-picker/` | Leaflet map picker; emits `{lat, lng, address}`. |
| `weather-card/` | Reusable current + 7-day + recommendations widget. |
| `obras-clima.service.ts` + `obras-clima/` | Weather across active obras + panel. |
| `rutas-clima.service.ts` | Trip-day weather + dispatch advisory for a destination. |
| `weather-bi.service.ts` | Weather-impact BI (días con lluvia / días adversos) over history. |
| `weather-alerts.service.ts` | Reads active (`vigente`) severe-weather alerts. |

## Data model (schema `sgc`)

- **`proyectos.latitud / longitud / direccion_geo`** — obra location.
- **`weather_snapshots`** — current-conditions history (temp, sensación, humedad,
  viento, precipitación, prob, nubosidad, uv, visibilidad, `codigo_tiempo` WMO,
  `crudo` jsonb). Written on Bitácora creation and by the cron. Powers BI.
- **`bitacoras.weather_snapshot_id`** — links a log entry to the weather captured at
  creation (auto, no manual input).
- **`weather_alerts`** — self-healing severe-condition alerts. `vigente=true` = active.
  One open row per `(proyecto, tipo)`; tipos: `tormenta`, `lluvia_intensa`,
  `viento_fuerte`, `calor_extremo`, `aire_peligroso`. In the `supabase_realtime`
  publication (drives toast + badge).
- **`rutas.destino_lat / destino_lng / destino_proyecto_id`** — route destination
  coordinates (obra link preferred over explicit point).

## Data flows

**Read (live weather):** consumer → `ContextService.getContexto(coords)` →
`WeatherService.getPronostico` (cache hit or `OpenMeteoProvider.getPronostico`) →
`RecommendationService.generar` → `{pronostico, recomendaciones}`. The `weather-card`
and `obras-clima` components self-fetch via this path.

**Write / background sync:** `pg_cron` (every 3h) → `net.http_post` (secret from
Vault) → edge fn `sync-weather-obras` → for each active obra with coords: fetch
Open-Meteo → insert `weather_snapshots` → detect severe conditions → open/dedup/
resolve `weather_alerts`.

**Alert → user:** `weather_alerts` INSERT hits `supabase_realtime` →
`RealtimeNotificacionesService` raises a toast; `NotificacionesService` counts
`vigente` alerts → badge on the Proyectos nav; the list shows on
`/proyectos/clima`.

## Caching

- **In-memory 30-min TTL** per rounded coordinate (`WeatherService`), shared across
  every consumer in a session, so opening Dashboard → Dirección → a project reuses
  one fetch.
- **Persisted history** (`weather_snapshots`) doubles as a long-term cache for BI.
- The cron refreshes proactively so data exists without anyone opening a page.

## Where it's consumed

Proyectos (form picker + detail weather card) · Bitácora (auto weather capture) ·
Dashboard + Panel de Dirección (`obras-clima` panel; Dirección alerts) ·
Proyectos → Reportes de clima (BI + active alerts) · Flota → Rutas (destination
weather + dispatch advisory) · nav badge + realtime toasts.

## Security

- No API keys for weather/maps (keyless providers).
- Edge fn `sync-weather-obras` is authed by a shared secret (`WEATHER_SYNC_SECRET`
  env + Vault `weather_sync_secret`), read by cron at execution time — never in git.
- `weather_snapshots` / `weather_alerts`: RLS, authenticated SELECT; writes only via
  the edge function (service_role).

## Operations

- **Cron:** `select * from cron.job where jobname='weather-sync-obras';`
  Unschedule: `select cron.unschedule('weather-sync-obras');`
- **Tune alert thresholds** (no redeploy): set function secrets `ALERT_LLUVIA_MM`,
  `ALERT_VIENTO_KMH`, `ALERT_CALOR_SENSACION`, `ALERT_AQI` (`supabase secrets set …`).
- **Manual run:** POST the function with header `x-sync-secret` (or trigger the cron
  SQL). Returns `{obras, insertados, alertas_abiertas, alertas_resueltas}`.
- **Redeploy:** `supabase functions deploy sync-weather-obras --no-verify-jwt`.

## Extending — add a new context source (e.g. traffic, air quality)

1. Define its domain shape in a model file (provider-independent).
2. Create a provider interface + token (mirror `WeatherProvider`) and a concrete
   implementation.
3. Add a service (fetch + cache) and fold it into `ContextService.getContexto` (or a
   sibling method) so consumers get it through the same facade.
4. If it should persist/alert, add a table + (optionally) the realtime publication +
   a cron step, mirroring weather.

## Swapping the weather provider

Implement `WeatherProvider` elsewhere and re-bind in `app.config.ts`:
`{ provide: WEATHER_PROVIDER, useClass: MyProvider }`. No consumer changes.

## Swapping maps to Google (future)

Rewrite `location-picker/` to use Google Maps JS SDK and keep emitting
`{lat, lng, address}`; add the API key via env. `GeocodingService` can likewise be
repointed. Requires a billing-enabled Google Maps key. DB is already
provider-independent — no schema change.

## Key decisions & rationale

- **Open-Meteo over OpenWeather/Tomorrow.io** — free, keyless, CORS-enabled,
  construction-relevant fields (precip probability, gusts, UV), hourly + 7-day.
  Removes the secrets/billing dependency for a first version.
- **Store coords, not provider IDs** — keeps the DB provider-independent.
- **pg_cron + edge function over client-only fetching** — history accumulates for BI
  without depending on user visits; keeps the browser light.
- **Alerts as a self-healing table (`vigente`)** rather than a per-user notifications
  table — SGC has no notifications table; badges are live counts and toasts are
  realtime, so weather alerts follow that existing pattern.

## Roadmap

Done: geolocation · weather cards · Bitácora auto-capture · dashboards · background
sync · BI reports · severe-weather alerts + notifications · transport/route weather ·
**air quality** (context + advisories + hazardous-air alerts).
Next: **traffic** (needs a commercial key — TomTom/HERE/Google; abstraction ready to
add behind an edge-function proxy) · sunrise-sunset · optional Google Maps swap · AI
assistant that reasons over accumulated context (weather + air + logistics + bitácora)
to answer "why is Project A delayed?".
