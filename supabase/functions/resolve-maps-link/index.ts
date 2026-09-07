// AM7 / AU16 / BK2 — Resuelve un link de Google Maps (incluidos los cortos
// maps.app.goo.gl / goo.gl/maps) a coordenadas lat/lng. El navegador NO puede
// seguir el redirect (CORS), por eso se hace aquí (servidor). Cadena completa:
//   0) BK2 — extraer la PRIMERA URL de un texto (Maps comparte a WhatsApp como
//      "Nombre del lugar\nhttps://maps.app.goo.gl/…"; copiar el mensaje copia
//      TODO). También acepta links sin esquema (WhatsApp a veces los muestra
//      pelados) y plus-codes / geo:lat,lng.
//   1) ¿coordenadas pegadas? → devolver directo (incluye geo:, q=, query=, daddr=).
//   2) seguir el redirect → extraer coords de la URL final (patrones !3d!4d,
//      /@lat,lng, /search/lat,lng, ?q=/query=/daddr=lat,lng).
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
  // BK2 — decodeURIComponent puede lanzar URIError con un `%` suelto (ej. "100%").
  // extractPlaceName ya lo protegía; a extractCoords se le había olvidado.
  let s: string;
  try {
    s = decodeURIComponent(raw);
  } catch {
    s = raw;
  }
  const patterns = [
    /!3d(-?\d{1,3}\.\d+)!4d(-?\d{1,3}\.\d+)/,          // marcador del place (preferido)
    // ?q= / &query= (el que genera la propia app) / &daddr= (compartir de WhatsApp)
    /[?&](?:q|query|daddr|destination)=(-?\d{1,3}\.\d+),\s*\+?\s*(-?\d{1,3}\.\d+)/,
    /\/search\/(-?\d{1,3}\.\d+),\s*\+?\s*(-?\d{1,3}\.\d+)/, // /search/lat,+lng
    /\/@(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)/,             // centro del mapa /@lat,lng
    /\bgeo:(-?\d{1,3}\.\d+),\s*(-?\d{1,3}\.\d+)/,       // geo:lat,lng (Android)
    /(?:^|[\s(])(-?\d{1,3}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)(?:[\s)]|$)/, // coords sueltas en texto
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

// BK2 — Google Plus Code (Open Location Code), p. ej. "PGWM+9F" o
// "8F9RPGWM+9F Santo Domingo". No se decodifica localmente: se resuelve por
// Places (searchText) igual que un nombre de lugar.
function looksLikePlusCode(s: string): boolean {
  return /(^|\s)[23456789CFGHJMPQRVWX]{2,8}\+[23456789CFGHJMPQRVWX]{2,3}(\s|$)/i.test(s);
}

// BK2 — Extrae la primera URL de un texto. Maps comparte a WhatsApp con el
// nombre del lugar en la primera línea y la URL debajo; copiar el mensaje copia
// las dos. También rescata links "pelados" (sin http/https) que algunas vistas
// de WhatsApp muestran así.
function extractUrl(input: string): { url: string | null; hadText: boolean } {
  const withScheme = input.match(/(https?:\/\/[^\s<>"']+)/i);
  if (withScheme) return { url: withScheme[1], hadText: withScheme[1].trim() !== input.trim() };
  const bare = input.match(/((?:maps\.app\.goo\.gl|goo\.gl\/maps|(?:www\.)?google\.[a-z.]+\/maps|maps\.google\.[a-z.]+)\/[^\s<>"']*)/i);
  if (bare) return { url: 'https://' + bare[1], hadText: bare[1].trim() !== input.trim() };
  return { url: null, hadText: false };
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

    // 1) ¿Coordenadas pegadas directamente? (incluye geo:, ?q=, &query=, &daddr=)
    const direct = extractCoords(input);
    if (direct) return json({ ...direct, source: 'coords', resolved_url: null });

    // 2) BK2 — extraer la primera URL del texto (Maps comparte "Nombre\nURL");
    //    acepta también el link "pelado" sin http/https.
    const { url: link, hadText } = extractUrl(input);

    if (!link) {
      // 2b) BK2 — ¿un plus-code o un nombre de lugar suelto? → Places.
      if (looksLikePlusCode(input)) {
        const place = await resolvePlaceByName(input);
        if (place) return json({ ...place, source: 'places', resolved_url: null, note: 'Resolví el plus-code por su nombre.' });
      }
      return json(
        { error: 'Eso no parece un link de Google Maps ni un par de coordenadas. Comparte desde Maps ("Compartir → Copiar enlace") o pega "lat, lng".' },
        400,
      );
    }

    if (!/goo\.gl|google\.[a-z.]+\/maps|maps\.google/i.test(link)) {
      return json(
        { error: 'El link no es de Google Maps. Comparte desde Maps ("Compartir → Copiar enlace") o pega "lat, lng".' },
        400,
      );
    }

    const finalUrl = await resolveFinalUrl(link);
    const tookFromText = hadText ? 'Tomé el link del mensaje. ' : '';

    // 2a) Coords en la URL final (place con @lat,lng o !3d!4d).
    const coords = extractCoords(finalUrl);
    if (coords) return json({ ...coords, source: 'maps_link', resolved_url: finalUrl, note: tookFromText || undefined });

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
          note: tookFromText || undefined,
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
