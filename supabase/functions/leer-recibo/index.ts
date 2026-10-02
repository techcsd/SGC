import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// ============================================================================
// CF4 — Lectura automática del recibo de combustible (y tablero/bomba) con visión.
//
//   El chofer toma la foto del recibo (y opcionalmente del tablero/odómetro y de
//   la bomba).  Esta edge las manda a un modelo de visión de Anthropic (la misma
//   ANTHROPIC_API_KEY que `assistant`) y devuelve los campos leídos con una
//   CONFIANZA por campo.  La app/web RELLENA los campos y el usuario confirma o
//   corrige — nunca se envía solo.
//
//   Entrada (POST, JWT del usuario):
//     { imagenes: [{ tipo: 'recibo'|'tablero'|'bomba', data: '<base64>', mime: 'image/jpeg' }] }
//   Salida:
//     { ok, lectura: { monto, galones, precio_galon, producto, numero_recibo, fecha,
//                      hora, estacion, ncf, bomba, tarjeta_ult4, km, horas },
//       confianza: { <campo>: 0..1 }, modelo }
//
//   Secrets: ANTHROPIC_API_KEY (obligatorio) · LEER_RECIBO_MODEL (opcional).
// ============================================================================

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
// Haiku 4.5 soporta visión y es barato; configurable.
const MODEL = Deno.env.get("LEER_RECIBO_MODEL") ?? Deno.env.get("ASSISTANT_MODEL") ?? "claude-haiku-4-5-20251001";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Precio aproximado (USD/1M tokens) para el costo estimado — Haiku 4.5.
const PRECIO_IN = 1.0 / 1_000_000;
const PRECIO_OUT = 5.0 / 1_000_000;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

// deno-lint-ignore no-explicit-any
type Any = any;

const TIPO_INSTRUCCION: Record<string, string> = {
  recibo: "Es la FOTO DE UN RECIBO/TICKET de estación de combustible (RD). Extrae: monto total pagado, galones (QTY), precio por galón (UNIT PRICE), producto/tipo de combustible (DIESEL/GASOLINA/GAS), número de recibo o ticket (TICKET NO), fecha, hora, nombre de la estación, NCF, número de bomba (PUMP), y los últimos 4 dígitos de la tarjeta si aparece.",
  tablero: "Es la FOTO DEL TABLERO/ODÓMETRO del vehículo. Extrae el kilometraje (km) si es un vehículo, o las horas de uso si es un equipo con horómetro.",
  bomba: "Es la FOTO DE LA BOMBA (dispensador). Extrae los galones y el monto mostrados, para cruzarlos con el recibo.",
};

const SYSTEM = `Eres un extractor de datos de recibos de combustible de la República Dominicana.
Lees imágenes (recibos, tableros/odómetros, bombas) y devuelves SOLO un objeto JSON válido, sin texto adicional, sin markdown.
Formato EXACTO:
{
  "monto": number|null, "galones": number|null, "precio_galon": number|null,
  "producto": string|null, "numero_recibo": string|null, "fecha": "YYYY-MM-DD"|null,
  "hora": "HH:MM"|null, "estacion": string|null, "ncf": string|null, "bomba": string|null,
  "tarjeta_ult4": string|null, "km": number|null, "horas": number|null,
  "confianza": { "<campo>": number }
}
Reglas:
- Números con punto decimal, sin separador de miles, sin símbolos de moneda.
- Si un campo no se ve o no aplica, ponlo en null y su confianza en 0.
- "confianza" es 0..1 por cada campo que SÍ leíste (qué tan seguro estás de ese valor exacto).
- producto: usa "diesel", "gasolina", "gasolina premium", "glp" o lo que diga el recibo.
- NO inventes. Si dudas, confianza baja.`;

async function leerParametro(svc: Any, clave: string, def: number): Promise<number> {
  const { data } = await svc.schema("sgc").from("parametros").select("valor").eq("clave", clave).maybeSingle();
  const n = data?.valor ? Number(data.valor) : NaN;
  return Number.isFinite(n) ? n : def;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Método no permitido" }, 405);
  if (!ANTHROPIC_API_KEY) return json({ ok: false, error: "Lectura de recibos no configurada (sin API key)." }, 503);

  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace("Bearer ", "");
  if (!token) return json({ ok: false, error: "No autenticado" }, 401);

  // Cliente con el JWT del usuario para identificarlo (RLS); service role para escribir uso_ia.
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authHeader } } });
  const svc = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { data: userData } = await userClient.auth.getUser();
  const userId = userData?.user?.id;
  if (!userId) return json({ ok: false, error: "Sesión inválida" }, 401);

  let payload: Any;
  try { payload = await req.json(); } catch { return json({ ok: false, error: "Cuerpo inválido" }, 400); }
  const imagenes: Any[] = Array.isArray(payload?.imagenes) ? payload.imagenes : [];
  if (!imagenes.length) return json({ ok: false, error: "Sin imágenes para leer." }, 400);
  if (imagenes.length > 4) return json({ ok: false, error: "Máximo 4 imágenes por lectura." }, 400);

  // ── Rate limit: por usuario/hora y global/día ──────────────────────────────
  const limHora = await leerParametro(svc, "leer_recibo_limite_usuario_hora", 30);
  const limDia = await leerParametro(svc, "leer_recibo_limite_diario_global", 400);
  const haceUnaHora = new Date(Date.now() - 3600_000).toISOString();
  const inicioDia = new Date(); inicioDia.setHours(0, 0, 0, 0);
  const [{ count: usoHora }, { count: usoDia }] = await Promise.all([
    svc.schema("sgc").from("uso_ia").select("id", { count: "exact", head: true })
      .eq("funcion", "leer_recibo").eq("usuario_id", userId).gte("created_at", haceUnaHora),
    svc.schema("sgc").from("uso_ia").select("id", { count: "exact", head: true })
      .eq("funcion", "leer_recibo").gte("created_at", inicioDia.toISOString()),
  ]);
  if ((usoHora ?? 0) >= limHora) return json({ ok: false, error: "Alcanzaste el límite de lecturas por hora. Escribe los datos a mano." }, 429);
  if ((usoDia ?? 0) >= limDia) return json({ ok: false, error: "Se alcanzó el límite diario de lecturas del sistema. Escribe los datos a mano." }, 429);

  // ── Construir el mensaje de visión ─────────────────────────────────────────
  const content: Any[] = [];
  for (const img of imagenes) {
    const tipo = String(img?.tipo ?? "recibo");
    const data = String(img?.data ?? "");
    const mime = String(img?.mime ?? "image/jpeg");
    if (!data) continue;
    content.push({ type: "text", text: TIPO_INSTRUCCION[tipo] ?? TIPO_INSTRUCCION.recibo });
    content.push({ type: "image", source: { type: "base64", media_type: mime, data } });
  }
  content.push({ type: "text", text: "Devuelve SOLO el JSON con los campos leídos y su confianza." });

  let anthRes: Response;
  try {
    anthRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: MODEL, max_tokens: 1024, system: SYSTEM, messages: [{ role: "user", content }] }),
    });
  } catch (_e) {
    return json({ ok: false, error: "No se pudo leer el recibo (red)." }, 502);
  }
  if (!anthRes.ok) {
    const t = await anthRes.text();
    console.error("anthropic error", anthRes.status, t.slice(0, 300));
    return json({ ok: false, error: "El lector de recibos no está disponible ahora." }, 502);
  }
  const anth = await anthRes.json();
  const texto: string = (anth?.content ?? []).map((c: Any) => c?.text ?? "").join("").trim();
  const inTok = anth?.usage?.input_tokens ?? 0;
  const outTok = anth?.usage?.output_tokens ?? 0;

  // Parsear el JSON (tolerante a ```json ... ``` o texto alrededor).
  let lectura: Any = null;
  try {
    const m = texto.match(/\{[\s\S]*\}/);
    lectura = m ? JSON.parse(m[0]) : null;
  } catch { lectura = null; }

  // Registrar uso (best-effort).
  try {
    await svc.schema("sgc").from("uso_ia").insert({
      usuario_id: userId, funcion: "leer_recibo", modelo: MODEL,
      tokens_in: inTok, tokens_out: outTok,
      costo_estimado: inTok * PRECIO_IN + outTok * PRECIO_OUT,
      meta: { imagenes: imagenes.map((i: Any) => i?.tipo ?? "recibo") },
    });
  } catch (e) { console.error("uso_ia insert", e); }

  if (!lectura) return json({ ok: false, error: "No se pudo interpretar el recibo. Escribe los datos a mano." }, 200);

  const confianza = lectura.confianza ?? {};
  delete lectura.confianza;
  return json({ ok: true, lectura, confianza, modelo: MODEL });
});
