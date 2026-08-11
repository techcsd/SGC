// AM7 — Resuelve un link de Google Maps (incluidos los cortos maps.app.goo.gl /
// goo.gl/maps) a coordenadas lat/lng. El navegador NO puede seguir el redirect
// (CORS), por eso se hace aquí (servidor). No requiere API key: sigue el redirect
// y extrae las coordenadas de la URL final (patrones !3d!4d, /@lat,lng,
// /search/lat,lng, ?q=lat,lng). También acepta coordenadas pegadas directamente.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// Extrae lat/lng de una URL de Google Maps o de un texto de coordenadas.
function extractCoords(raw: string): { lat: number; lng: number } | null {
  const s = decodeURIComponent(raw);
  const patterns = [
    /!3d(-?\d{1,3}\.\d+)!4d(-?\d{1,3}\.\d+)/,          // marcador del place (preferido)
    /[?&]q=(-?\d{1,3}\.\d+),\s*(-?\d{1,3}\.\d+)/,       // ?q=lat,lng
    /\/search\/(-?\d{1,3}\.\d+),\s*\+?\s*(-?\d{1,3}\.\d+)/, // /search/lat,+lng
    /\/@(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)/,             // centro del mapa /@lat,lng
    /^\s*(-?\d{1,3}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)\s*$/,  // coords pegadas
  ];
  for (const p of patterns) {
    const m = s.match(p);
    if (m) {
      const lat = parseFloat(m[1]);
      const lng = parseFloat(m[2]);
      if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) return { lat, lng };
    }
  }
  return null;
}

// Sigue redirects manualmente (hasta 6 saltos) para capturar la URL final.
async function resolveFinalUrl(url: string): Promise<string> {
  let current = url;
  for (let i = 0; i < 6; i++) {
    const res = await fetch(current, {
      method: 'GET',
      redirect: 'manual',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SGC/1.0)' },
    });
    const loc = res.headers.get('location');
    // Consumir el body para liberar la conexión.
    try { await res.arrayBuffer(); } catch { /* noop */ }
    if (loc && res.status >= 300 && res.status < 400) {
      current = new URL(loc, current).toString();
      // Si la URL ya trae coordenadas, cortar temprano.
      if (extractCoords(current)) return current;
      continue;
    }
    return current;
  }
  return current;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const { url, texto } = await req.json().catch(() => ({}));
    const input: string | undefined = (url ?? texto)?.toString().trim();
    if (!input) return json({ error: 'Falta el link o las coordenadas.' }, 400);

    // 1) ¿Coordenadas pegadas directamente?
    const direct = extractCoords(input);
    if (direct) return json({ ...direct, source: 'coords', resolved_url: null });

    // 2) ¿Es una URL de Maps? Seguir el redirect y extraer.
    if (!/^https?:\/\//i.test(input) || !/goo\.gl|google\.[a-z.]+\/maps/i.test(input)) {
      return json({ error: 'No es un link de Google Maps ni un par de coordenadas válido.' }, 400);
    }
    const finalUrl = await resolveFinalUrl(input);
    const coords = extractCoords(finalUrl);
    if (!coords) {
      return json({ error: 'No se pudieron extraer coordenadas de ese link.', resolved_url: finalUrl }, 422);
    }
    return json({ ...coords, source: 'maps_link', resolved_url: finalUrl });
  } catch (e) {
    return json({ error: `Error resolviendo la ubicación: ${e instanceof Error ? e.message : e}` }, 500);
  }
});
