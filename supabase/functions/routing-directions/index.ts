// Proxy seguro de Google Directions: la GOOGLE_MAPS_API_KEY vive como secreto de
// la edge function (NUNCA en el frontend ni en el repo). Devuelve distancia (km)
// y duración (min) manejando en auto entre dos coordenadas.
//
// Google Directions (web service) no envía cabeceras CORS y su key no debe
// exponerse en el navegador → por eso se llama desde aquí (servidor).

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  try {
    const key = Deno.env.get('GOOGLE_MAPS_API_KEY');
    if (!key) {
      return new Response(JSON.stringify({ error: 'sin key' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { origen_lat, origen_lng, destino_lat, destino_lng } = await req.json();
    if ([origen_lat, origen_lng, destino_lat, destino_lng].some((v) => typeof v !== 'number')) {
      return new Response(JSON.stringify({ error: 'coordenadas inválidas' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const url =
      `https://maps.googleapis.com/maps/api/directions/json` +
      `?origin=${origen_lat},${origen_lng}&destination=${destino_lat},${destino_lng}` +
      `&mode=driving&region=do&key=${key}`;
    const res = await fetch(url);
    const data = await res.json();
    const leg = data?.routes?.[0]?.legs?.[0];
    if (data?.status !== 'OK' || !leg) {
      return new Response(JSON.stringify({ error: data?.status ?? 'sin ruta' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(
      JSON.stringify({
        distancia_km: Math.round((leg.distance.value / 1000) * 10) / 10,
        duracion_min: Math.round(leg.duration.value / 60),
        proveedor: 'google',
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
