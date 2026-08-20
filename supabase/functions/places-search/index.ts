// AO2 — Búsqueda de lugares con Google Places API (New v1), server-side.
// La GOOGLE_MAPS_API_KEY (key de SERVIDOR) vive como secreto de la edge function,
// NUNCA en el navegador ni en el repo (lección AG1). Contrato ÚNICO consumido por
// web y app: cualquier lugar registrado en Google aparece; al elegir devuelve
// nombre + lat/lng + dirección. Sesgo a República Dominicana (regionCode "do").
//
// Acciones (body.action):
//   'autocomplete' { input, sessionToken? }        → { predictions: [{ placeId, primary, secondary, description }] }
//   'details'      { placeId, sessionToken? }       → { name, lat, lng, address }
//   'text'         { input, lat?, lng? }            → { results: [{ placeId, name, lat, lng, address }] }
//
// El sessionToken (opcional) agrupa autocomplete+details en una sesión de facturación
// (lo genera el cliente y lo pasa igual en ambas llamadas). Ver checklist de Cloud.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const REGION = 'do';        // República Dominicana
const LANG = 'es';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const key = Deno.env.get('GOOGLE_MAPS_API_KEY');
    if (!key) return json({ error: 'sin key' }, 500);

    const body = await req.json().catch(() => ({}));
    const action = String(body?.action ?? 'autocomplete');

    // ── Autocomplete: sugerencias mientras se escribe ────────────────────────
    if (action === 'autocomplete') {
      const input = String(body?.input ?? '').trim();
      if (input.length < 2) return json({ predictions: [] });

      const res = await fetch('https://places.googleapis.com/v1/places:autocomplete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key },
        body: JSON.stringify({
          input,
          includedRegionCodes: [REGION],
          languageCode: LANG,
          ...(body?.sessionToken ? { sessionToken: String(body.sessionToken) } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) return json({ error: data?.error?.message ?? 'places error', predictions: [] }, 200);

      const predictions = (data?.suggestions ?? [])
        .map((s: any) => s?.placePrediction)
        .filter(Boolean)
        .map((p: any) => ({
          placeId: p.placeId,
          primary: p.structuredFormat?.mainText?.text ?? p.text?.text ?? '',
          secondary: p.structuredFormat?.secondaryText?.text ?? '',
          description: p.text?.text ?? '',
        }));

      // AT25 — Autocomplete sesga por prefijo/dirección y sub-representa negocios
      // locales por nombre (p.ej. "Ferretería MC"). Si no hay sugerencias, se cae
      // a Text Search (searchText), que sí encuentra POIs por nombre (insensible a
      // acentos/mayúsculas). Se mapea a la MISMA forma `prediction` (comparten placeId),
      // así el contrato del cliente no cambia y `details` sigue funcionando igual.
      if (predictions.length === 0) {
        try {
          const tRes = await fetch('https://places.googleapis.com/v1/places:searchText', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Goog-Api-Key': key,
              'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress',
            },
            body: JSON.stringify({ textQuery: input, regionCode: REGION, languageCode: LANG }),
          });
          const tData = await tRes.json();
          if (tRes.ok) {
            const fallback = (tData?.places ?? [])
              .filter((p: any) => p?.id)
              .slice(0, 8)
              .map((p: any) => ({
                placeId: p.id,
                primary: p.displayName?.text ?? '',
                secondary: p.formattedAddress ?? '',
                description: [p.displayName?.text, p.formattedAddress].filter(Boolean).join(', '),
              }));
            return json({ predictions: fallback, source: 'text' });
          }
        } catch (_) { /* si el fallback falla, se devuelve la lista vacía original */ }
      }
      return json({ predictions });
    }

    // ── Details: al elegir una sugerencia → coords + nombre + dirección ──────
    if (action === 'details') {
      const placeId = String(body?.placeId ?? '').trim();
      if (!placeId) return json({ error: 'placeId requerido' }, 400);

      const qs = new URLSearchParams({ languageCode: LANG });
      if (body?.sessionToken) qs.set('sessionToken', String(body.sessionToken));
      const res = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}?${qs}`, {
        headers: {
          'X-Goog-Api-Key': key,
          'X-Goog-FieldMask': 'id,displayName,formattedAddress,location',
        },
      });
      const data = await res.json();
      if (!res.ok || !data?.location) return json({ error: data?.error?.message ?? 'no encontrado' }, 200);

      return json({
        name: data.displayName?.text ?? '',
        lat: data.location.latitude,
        lng: data.location.longitude,
        address: data.formattedAddress ?? '',
      });
    }

    // ── Text search: fallback de una sola llamada (coords directas) ──────────
    if (action === 'text') {
      const input = String(body?.input ?? '').trim();
      if (input.length < 2) return json({ results: [] });

      const bias =
        typeof body?.lat === 'number' && typeof body?.lng === 'number'
          ? { locationBias: { circle: { center: { latitude: body.lat, longitude: body.lng }, radius: 50000 } } }
          : {};
      const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': key,
          'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location',
        },
        body: JSON.stringify({ textQuery: input, regionCode: REGION, languageCode: LANG, ...bias }),
      });
      const data = await res.json();
      if (!res.ok) return json({ error: data?.error?.message ?? 'places error', results: [] }, 200);

      const results = (data?.places ?? [])
        .filter((p: any) => p?.location)
        .map((p: any) => ({
          placeId: p.id,
          name: p.displayName?.text ?? '',
          lat: p.location.latitude,
          lng: p.location.longitude,
          address: p.formattedAddress ?? '',
        }));
      return json({ results });
    }

    return json({ error: `acción desconocida: ${action}` }, 400);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
