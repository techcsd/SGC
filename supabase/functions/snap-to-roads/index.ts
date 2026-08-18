// AV7 — Map-matching: pega una polyline cruda a las calles (Google Roads API
// snapToRoads) y CACHEA el resultado por hash de contenido en sgc.snap_cache.
// La GOOGLE_MAPS_API_KEY vive como secreto de la edge function (NUNCA en el repo
// ni el frontend). Roads API acepta máximo 100 puntos por request → se trocea y
// se vuelve a unir. Si algo falla, se devuelven los puntos crudos (degradación
// elegante: nunca se rompe el mapa).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

type LL = [number, number];

// md5 hex de un string (para la clave de caché por contenido).
async function md5(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('MD5', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Trocea en grupos de <=100 puntos, solapando 1 punto para no perder continuidad.
function chunk(coords: LL[], size = 100): LL[][] {
  if (coords.length <= size) return [coords];
  const out: LL[][] = [];
  for (let i = 0; i < coords.length; i += size - 1) {
    out.push(coords.slice(i, i + size));
    if (i + size >= coords.length) break;
  }
  return out;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  let coords: LL[] = [];
  try {
    const body = await req.json();
    coords = Array.isArray(body?.coords) ? body.coords : [];
  } catch {
    return new Response(JSON.stringify({ error: 'body inválido' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Filtra puntos válidos.
  coords = coords.filter(
    (c) => Array.isArray(c) && typeof c[0] === 'number' && typeof c[1] === 'number',
  );
  // Menos de 2 puntos: nada que matchear.
  if (coords.length < 2) {
    return new Response(JSON.stringify({ coords, snapped: false, cached: false }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const key = await md5('v1|' + coords.map((c) => c[0].toFixed(6) + ',' + c[1].toFixed(6)).join(';'));

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const admin = supabaseUrl && serviceKey ? createClient(supabaseUrl, serviceKey) : null;

  // 1) Caché.
  if (admin) {
    const { data } = await admin.schema('sgc').from('snap_cache').select('snapped').eq('cache_key', key).maybeSingle();
    if (data?.snapped) {
      return new Response(JSON.stringify({ coords: data.snapped, snapped: true, cached: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
  }

  // 2) Roads API.
  const apiKey = Deno.env.get('GOOGLE_MAPS_API_KEY');
  if (!apiKey) {
    return new Response(JSON.stringify({ coords, snapped: false, cached: false, error: 'sin key' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const snapped: LL[] = [];
    for (const part of chunk(coords, 100)) {
      const path = part.map((c) => `${c[0]},${c[1]}`).join('|');
      const url = `https://roads.googleapis.com/v1/snapToRoads?interpolate=true&path=${encodeURIComponent(path)}&key=${apiKey}`;
      const res = await fetch(url);
      const data = await res.json();
      if (Array.isArray(data?.snappedPoints)) {
        for (const p of data.snappedPoints) {
          const loc = p?.location;
          if (loc && typeof loc.latitude === 'number' && typeof loc.longitude === 'number') {
            snapped.push([loc.latitude, loc.longitude]);
          }
        }
      }
    }

    if (snapped.length < 2) {
      // Roads no devolvió nada útil (área sin calles mapeadas): usa lo crudo.
      return new Response(JSON.stringify({ coords, snapped: false, cached: false }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 3) Guarda en caché (best-effort).
    if (admin) {
      await admin.schema('sgc').from('snap_cache').insert({
        cache_key: key, snapped, puntos_in: coords.length, puntos_out: snapped.length,
      }).select().maybeSingle().then(() => {}, () => {});
    }

    return new Response(JSON.stringify({ coords: snapped, snapped: true, cached: false }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ coords, snapped: false, cached: false, error: String(e) }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
