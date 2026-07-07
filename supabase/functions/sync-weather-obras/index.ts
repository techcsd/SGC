import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Background weather sync + severe-weather alerting for the Intelligent Context System.
//
// Every run (pg_cron, every 3h) this:
//   1. Snapshots current conditions for each active obra with coords into
//      sgc.weather_snapshots (so weather history accumulates for BI).
//   2. Maintains a self-healing set of sgc.weather_alerts: opens a peligro-level
//      alert when a severe condition appears (storm / heavy rain / high wind /
//      extreme heat) and resolves it (vigente=false) when the condition clears.
//      One open alert per (obra, tipo) — no spam. New inserts hit the
//      supabase_realtime publication, so the frontend shows a toast + badge.
//
// Deployed with --no-verify-jwt; the caller is the DB (or a manual admin invoke),
// authed by the x-sync-secret shared secret. Thresholds are env-tunable.

const OPEN_METEO = "https://api.open-meteo.com/v1/forecast";
const OPEN_METEO_AIR = "https://air-quality-api.open-meteo.com/v1/air-quality";

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

function envNum(name: string, fallback: number): number {
  const v = Number(Deno.env.get(name));
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

interface OMResponse {
  current?: Record<string, number> & { time?: string };
  hourly?: { time: string[]; [k: string]: (number | null)[] | string[] };
}

/** Mirror of OpenMeteoProvider.mapActual. */
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

async function fetchAqi(lat: number, lng: number): Promise<number | null> {
  try {
    const params = new URLSearchParams({
      latitude: String(lat),
      longitude: String(lng),
      current: "us_aqi",
      timezone: "auto",
    });
    const res = await fetch(`${OPEN_METEO_AIR}?${params.toString()}`);
    if (!res.ok) return null;
    const data = (await res.json()) as { current?: { us_aqi?: number } };
    return data.current?.us_aqi ?? null;
  } catch {
    return null;
  }
}

type Actual = ReturnType<typeof mapActual>;
interface AlertaDetectada {
  tipo: string;
  titulo: string;
  detalle: string;
}

/** Severe (peligro-level) conditions worth a notification. Stricter than the
 *  in-app RecommendationService advisories, so the bell stays meaningful. */
function detectarSeveras(a: Actual, aqi: number | null): AlertaDetectada[] {
  const LLUVIA_MM = envNum("ALERT_LLUVIA_MM", 4);
  const VIENTO_KMH = envNum("ALERT_VIENTO_KMH", 40);
  const CALOR = envNum("ALERT_CALOR_SENSACION", 38);
  const AQI = envNum("ALERT_AQI", 200);
  const out: AlertaDetectada[] = [];

  if ((a.codigo_tiempo ?? 0) >= 95) {
    out.push({
      tipo: "tormenta",
      titulo: "Tormenta eléctrica",
      detalle: "Tormenta en la zona de la obra. Suspende trabajos en exterior y en altura.",
    });
  }
  if ((a.precipitacion_mm ?? 0) >= LLUVIA_MM) {
    out.push({
      tipo: "lluvia_intensa",
      titulo: "Lluvia intensa",
      detalle: `Lluvia de ${a.precipitacion_mm} mm. Evita el vaciado de concreto y protege materiales.`,
    });
  }
  if ((a.viento_kmh ?? 0) >= VIENTO_KMH) {
    out.push({
      tipo: "viento_fuerte",
      titulo: "Vientos fuertes",
      detalle: `Viento de ${Math.round(a.viento_kmh!)} km/h. Suspende grúas y trabajos en altura.`,
    });
  }
  const calor = a.sensacion ?? a.temperatura ?? 0;
  if (calor >= CALOR) {
    out.push({
      tipo: "calor_extremo",
      titulo: "Calor extremo",
      detalle: `Sensación térmica de ${Math.round(calor)}°C. Programa pausas e hidratación frecuente.`,
    });
  }
  if (aqi != null && aqi >= AQI) {
    out.push({
      tipo: "aire_peligroso",
      titulo: "Mala calidad del aire",
      detalle: `Índice de calidad del aire ${Math.round(aqi)}. Limita el trabajo prolongado al aire libre y usa protección respiratoria.`,
    });
  }
  return out;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

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

  // 1) Fetch weather + build snapshot rows + detect severe conditions per obra.
  const snapRows: Record<string, unknown>[] = [];
  const severasPorObra = new Map<string, AlertaDetectada[]>();
  const fallos: { proyecto: string; error: string }[] = [];

  for (const o of (obras ?? []) as { id: string; latitud: number; longitud: number }[]) {
    try {
      // Weather is required; air quality is best-effort enrichment.
      const [actual, aqi] = await Promise.all([
        fetchActual(o.latitud, o.longitud),
        fetchAqi(o.latitud, o.longitud),
      ]);
      snapRows.push({ proyecto_id: o.id, latitud: o.latitud, longitud: o.longitud, ...actual });
      severasPorObra.set(o.id, detectarSeveras(actual, aqi));
    } catch (e) {
      fallos.push({ proyecto: o.id, error: e instanceof Error ? e.message : "error" });
    }
  }

  // 2) Insert snapshots, keep proyecto_id -> snapshot_id to link alerts.
  const snapshotIdPorObra = new Map<string, string>();
  if (snapRows.length > 0) {
    const { data: inserted, error: insErr } = await supabase
      .from("weather_snapshots")
      .insert(snapRows)
      .select("id, proyecto_id");
    if (insErr) return json({ error: insErr.message, obras: obras?.length ?? 0 }, 500);
    for (const r of (inserted ?? []) as { id: string; proyecto_id: string }[]) {
      snapshotIdPorObra.set(r.proyecto_id, r.id);
    }
  }

  // 3) Maintain alerts: open new severe conditions, resolve cleared ones.
  const obraIds = [...severasPorObra.keys()];
  let abiertas = 0;
  let resueltas = 0;

  if (obraIds.length > 0) {
    const { data: vigentes } = await supabase
      .from("weather_alerts")
      .select("id, proyecto_id, tipo")
      .eq("vigente", true)
      .in("proyecto_id", obraIds);

    const vigentesPorObra = new Map<string, Map<string, string>>(); // obra -> tipo -> alertId
    for (const v of (vigentes ?? []) as { id: string; proyecto_id: string; tipo: string }[]) {
      if (!vigentesPorObra.has(v.proyecto_id)) vigentesPorObra.set(v.proyecto_id, new Map());
      vigentesPorObra.get(v.proyecto_id)!.set(v.tipo, v.id);
    }

    const nuevas: Record<string, unknown>[] = [];
    const resolverIds: string[] = [];

    for (const obraId of obraIds) {
      const severas = severasPorObra.get(obraId) ?? [];
      const actuales = new Set(severas.map((s) => s.tipo));
      const abiertasObra = vigentesPorObra.get(obraId) ?? new Map<string, string>();

      // Open alerts for severe conditions not already open.
      for (const s of severas) {
        if (!abiertasObra.has(s.tipo)) {
          nuevas.push({
            proyecto_id: obraId,
            snapshot_id: snapshotIdPorObra.get(obraId) ?? null,
            tipo: s.tipo,
            nivel: "peligro",
            titulo: s.titulo,
            detalle: s.detalle,
          });
        }
      }
      // Resolve open alerts whose condition is no longer present.
      for (const [tipo, alertId] of abiertasObra) {
        if (!actuales.has(tipo)) resolverIds.push(alertId);
      }
    }

    if (nuevas.length > 0) {
      const { error: e } = await supabase.from("weather_alerts").insert(nuevas);
      if (!e) abiertas = nuevas.length;
    }
    if (resolverIds.length > 0) {
      const { error: e } = await supabase
        .from("weather_alerts")
        .update({ vigente: false, resuelto_en: new Date().toISOString() })
        .in("id", resolverIds);
      if (!e) resueltas = resolverIds.length;
    }
  }

  return json({
    ok: true,
    obras: obras?.length ?? 0,
    insertados: snapRows.length,
    alertas_abiertas: abiertas,
    alertas_resueltas: resueltas,
    fallos,
  });
});
