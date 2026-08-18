// AU7 — Geocodificación inversa (lat/lng → dirección) para nombrar las paradas del
// recorrido diario, estilo Google Timeline. La key de Google vive SOLO como secreto
// de la edge function (lección AG1: nunca en el navegador ni en el repo). Cachea el
// resultado en sgc.geocode_cache para no gastar cuota en cada visita.
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { lat, lng } = await req.json().catch(() => ({}));
    const nlat = Number(lat);
    const nlng = Number(lng);
    if (!Number.isFinite(nlat) || !Number.isFinite(nlng)) {
      return json({ error: "lat/lng inválidos" }, 400);
    }

    // Clave de caché: 4 decimales (~11 m) — resolución de lugar, no de punto.
    const latKey = Math.round(nlat * 1e4) / 1e4;
    const lngKey = Math.round(nlng * 1e4) / 1e4;

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { db: { schema: "sgc" }, auth: { persistSession: false } },
    );

    // 1) Caché
    const { data: hit } = await supabase
      .from("geocode_cache")
      .select("direccion")
      .eq("lat_key", latKey)
      .eq("lng_key", lngKey)
      .maybeSingle();
    if (hit) return json({ direccion: hit.direccion, cached: true });

    // 2) Google Geocoding API (reverse)
    const key = Deno.env.get("GOOGLE_MAPS_API_KEY");
    if (!key) return json({ error: "sin key" }, 500);
    const url =
      `https://maps.googleapis.com/maps/api/geocode/json?latlng=${nlat},${nlng}` +
      `&language=es&region=DO&key=${key}`;
    const res = await fetch(url);
    const body = await res.json();
    let direccion: string | null = null;
    if (body?.status === "OK" && Array.isArray(body.results) && body.results.length) {
      // Preferimos un nombre de lugar (establishment/point_of_interest) si existe;
      // si no, la dirección formateada del primer resultado.
      const poi = body.results.find((r: { types?: string[] }) =>
        r.types?.some((t) => t === "establishment" || t === "point_of_interest"),
      );
      direccion = (poi ?? body.results[0])?.formatted_address ?? null;
    }

    // 3) Cachear (aunque sea null, para no reintentar en bucle una zona sin dato).
    await supabase
      .from("geocode_cache")
      .upsert({ lat_key: latKey, lng_key: lngKey, direccion });

    return json({ direccion, cached: false });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
