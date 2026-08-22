// AM7 / AU16 — Resuelve un link de Google Maps (incluidos los cortos
// maps.app.goo.gl / goo.gl/maps) a coordenadas lat/lng. El navegador NO puede
// seguir el redirect (CORS), por eso se hace aquí (servidor). Cadena completa:
//   1) ¿coordenadas pegadas? → devolver directo.
//   2) seguir el redirect → extraer coords de la URL final (patrones !3d!4d,
//      /@lat,lng, /search/lat,lng, ?q=lat,lng).
//   3) AU16 — si la URL final NO trae coords pero SÍ un nombre de lugar
//      (/maps/place/<NOMBRE>/, típico de los negocios locales como "Ferretería
//      MC"), resolver ese nombre con Google Places (searchText) → coords + dir.
// La GOOGLE_MAPS_API_KEY (key de SERVIDOR) es opcional: sin ella el paso 3 no
// corre, pero 1 y 2 siguen funcionando.

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

// AU16 — UA de navegador real. Con un UA "compatible; SGC/1.0" Google puede
// devolver una página de consentimiento (consent.google.com) en vez del redirect
// al lugar, y ahí no hay coordenadas ni nombre que extraer.
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

// AU16 — Extrae el nombre/dirección del lugar de una URL /maps/place/<NOMBRE>/…
// (los negocios locales resuelven a esta forma SIN coords, p.ej. "Ferretería MC").
function extractPlaceName(url: string): string | null {
  const m = url.match(/\/maps\/place\/([^/@]+)/);
  if (!m) return null;
  try {
    const name = decodeURIComponent(m[1]).replace(/\+/g, ' ').trim();
    return name.length >= 2 ? name : null;
  } catch {
    return null;
  }
}

// Sigue redirects manualmente (hasta 6 saltos) para capturar la URL final.
async function resolveFinalUrl(url: string): Promise<string> {
  let current = url;
  for (let i = 0; i < 6; i++) {
    const res = await fetch(current, {
      method: 'GET',
      redirect: 'manual',
      headers: { 'User-Agent': BROWSER_UA },
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

// AU16 — Resuelve un nombre/dirección de lugar a coords vía Google Places
// (searchText, New API). Reusa la GOOGLE_MAPS_API_KEY de servidor (misma que
// places-search/AO2). Devuelve null si no hay key o no hay resultado.
async function resolvePlaceByName(
  query: string,
): Promise<{ lat: number; lng: number; name: string; address: string } | null> {
  const key = Deno.env.get('GOOGLE_MAPS_API_KEY');
  if (!key) return null;
  try {
    const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': key,
        'X-Goog-FieldMask': 'places.displayName,places.formattedAddress,places.location',
      },
      body: JSON.stringify({ textQuery: query, regionCode: 'do', languageCode: 'es' }),
    });
    const data = await res.json();
    const place = res.ok ? (data?.places ?? [])[0] : null;
    if (!place?.location) return null;
    return {
      lat: place.location.latitude,
      lng: place.location.longitude,
      name: place.displayName?.text ?? '',
      address: place.formattedAddress ?? '',
    };
  } catch {
    return null;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const { url, texto } = await req.json().catch(() => ({}));
    const input: string | undefined = (url ?? texto)?.toString().trim();
    if (!input) return json({ error: 'Pega un link de Google Maps o unas coordenadas (lat, lng).' }, 400);

    // 1) ¿Coordenadas pegadas directamente?
    const direct = extractCoords(input);
    if (direct) return json({ ...direct, source: 'coords', resolved_url: null });

    // 2) ¿Es una URL de Maps? Seguir el redirect y extraer.
    if (!/^https?:\/\//i.test(input) || !/goo\.gl|google\.[a-z.]+\/maps/i.test(input)) {
      return json(
        { error: 'Eso no parece un link de Google Maps ni un par de coordenadas. Usa "Compartir → Copiar enlace" desde Maps, o pega "lat, lng".' },
        400,
      );
    }

    const finalUrl = await resolveFinalUrl(input);

    // 2a) Coords en la URL final (place con @lat,lng o !3d!4d).
    const coords = extractCoords(finalUrl);
    if (coords) return json({ ...coords, source: 'maps_link', resolved_url: finalUrl });

    // 3) AU16 — Sin coords pero con nombre de lugar (negocios locales): Places.
    const placeName = extractPlaceName(finalUrl);
    if (placeName) {
      const place = await resolvePlaceByName(placeName);
      if (place) {
        return json({
          lat: place.lat,
          lng: place.lng,
          name: place.name || placeName,
          address: place.address,
          source: 'places',
          resolved_url: finalUrl,
        });
      }
      // Hay nombre pero Places no lo ubicó (o falta la key): devolver el nombre
      // para que el cliente ofrezca el buscador con ese texto precargado.
      return json(
        {
          error: 'El link apunta a un lugar sin coordenadas exactas. Búscalo por nombre o marca el punto en el mapa.',
          suggest_query: placeName,
          resolved_url: finalUrl,
        },
        422,
      );
    }

    // 4) Ni coords ni nombre: probable "ubicación en tiempo real" (no resoluble).
    return json(
      {
        error:
          'No pudimos sacar una ubicación de ese link. Si es una "ubicación en tiempo real" de WhatsApp/Maps, no se puede fijar: busca el lugar por nombre, marca el punto en el mapa o pega las coordenadas.',
        resolved_url: finalUrl,
      },
      422,
    );
  } catch (e) {
    return json({ error: `No pudimos abrir el link de Google. Intenta de nuevo o marca el punto en el mapa. (${e instanceof Error ? e.message : e})` }, 500);
  }
});
