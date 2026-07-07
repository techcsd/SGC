import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Background weather sync for the Intelligent Context System.
//
// Snapshots current conditions for every active, in-progress obra that has
// coordinates and stores them in sgc.weather_snapshots — so weather history
// accumulates on its own (for BI like "días perdidos por lluvia") without
// depending on a user opening a project or creating a bitácora.
//
// Invoked on a schedule by pg_cron (see sql/2026-07-07-weather-cron.sql), which
// passes a shared secret in the x-sync-secret header. Deployed with
// --no-verify-jwt because the caller is the database, not a logged-in user;
// the secret is the auth boundary. Provider mapping mirrors
// src/shared/context/open-meteo.provider.ts so cron snapshots match what the
// frontend shows.

const OPEN_METEO = "https://api.open-meteo.com/v1/forecast";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-sync-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

interface OMResponse {
  current?: Record<string, number> & { time?: string };
  hourly?: { time: string[]; [k: string]: (number | null)[] | string[] };
}

/** Mirror of OpenMeteoProvider.mapActual — current conditions + current-hour
 *  extras (UV, visibility, precip probability) pulled from the hourly arrays. */
function mapActual(data: OMResponse) {
  const c = data.current ?? {};
  const hourly = data.hourly;
  let idx = 0;
  if (hourly?.time && c.time) {
    const found = hourly.time.indexOf(c.time.slice(0, 13) + ":00");
    idx = found >= 0 ? found : hourly.time.findIndex((t) => t >= (c.time ?? ""));
    if (idx < 0) idx = 0;
  }
  const h = (key: string): number | null => {
    const arr = hourly?.[key] as (number | null)[] | undefined;
    return arr ? (arr[idx] ?? null) : null;
  };
  const vis = h("visibility");
  return {
    capturado_en: c.time ?? new Date().toISOString(),
    temperatura: c["temperature_2m"] ?? null,
    sensacion: c["apparent_temperature"] ?? null,
    humedad: c["relative_humidity_2m"] ?? null,
    viento_kmh: c["wind_speed_10m"] ?? null,
    viento_dir: c["wind_direction_10m"] ?? null,
    precipitacion_mm: c["precipitation"] ?? null,
    prob_precipitacion: h("precipitation_probability"),
    nubosidad: c["cloud_cover"] ?? null,
    uv: h("uv_index"),
    visibilidad_km: vis != null ? Math.round(vis / 100) / 10 : null,
    codigo_tiempo: c["weather_code"] ?? null,
    crudo: data.current ?? null,
  };
}

async function fetchActual(lat: number, lng: number) {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lng),
    current:
      "temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,cloud_cover,wind_speed_10m,wind_direction_10m",
    hourly: "precipitation_probability,uv_index,visibility",
    timezone: "auto",
    forecast_days: "1",
  });
  const res = await fetch(`${OPEN_METEO}?${params.toString()}`);
  if (!res.ok) throw new Error(`Open-Meteo ${res.status}`);
  return mapActual((await res.json()) as OMResponse);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  // Shared-secret auth: the DB cron (or a manual admin invoke) must present the
  // secret. Never runs open — if the secret isn't configured, refuse.
  const expected = Deno.env.get("WEATHER_SYNC_SECRET");
  if (!expected) return json({ error: "WEATHER_SYNC_SECRET no configurado." }, 500);
  if (req.headers.get("x-sync-secret") !== expected) {
    return json({ error: "No autorizado." }, 401);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { db: { schema: "sgc" } },
  );

  const { data: obras, error } = await supabase
    .from("proyectos")
    .select("id, latitud, longitud")
    .eq("activo", true)
    .eq("estado", "en_progreso")
    .not("latitud", "is", null)
    .not("longitud", "is", null);

  if (error) return json({ error: error.message }, 500);

  const rows: Record<string, unknown>[] = [];
  const fallos: { proyecto: string; error: string }[] = [];

  for (const o of (obras ?? []) as { id: string; latitud: number; longitud: number }[]) {
    try {
      const actual = await fetchActual(o.latitud, o.longitud);
      rows.push({ proyecto_id: o.id, latitud: o.latitud, longitud: o.longitud, ...actual });
    } catch (e) {
      fallos.push({ proyecto: o.id, error: e instanceof Error ? e.message : "error" });
    }
  }

  let insertados = 0;
  if (rows.length > 0) {
    const { error: insErr } = await supabase.from("weather_snapshots").insert(rows);
    if (insErr) return json({ error: insErr.message, obras: obras?.length ?? 0 }, 500);
    insertados = rows.length;
  }

  return json({ ok: true, obras: obras?.length ?? 0, insertados, fallos });
});
