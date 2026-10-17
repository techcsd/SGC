import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// ============================================================================
// CQ1 — Lectura automática de la COTIZACIÓN de una compra tecnológica (PDF o
// foto) con visión/documentos de Anthropic. Xaviel: "the cotization maded for
// it must be uploadable to the system... the system READ the uploaded
// cotization and fill the articles automatically; the user just reviews and
// corrects." Calcado del patrón de `leer-recibo` (consentimiento IA, rate
// limit, uso_ia), pero para UNA sola cotización por llamada y aceptando PDF
// (bloque `document`) además de imagen (bloque `image`).
//
//   Entrada (POST, JWT del usuario):
//     { archivo: { data: '<base64>', mime: 'application/pdf'|'image/jpeg'|'image/png'|'image/webp' } }
//   Salida:
//     { ok, lectura: { proveedor, fecha, moneda, articulos: [{descripcion,
//                      cantidad, unidad, precio}], itbis, total },
//       confianza: { <campo>: 0..1 }, modelo, costo_usd }
//
//   Secrets: ANTHROPIC_API_KEY (obligatorio) · LEER_COTIZACION_MODEL (opcional).
// ============================================================================

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
// Haiku 4.5 soporta visión + documentos PDF nativos y es barato; configurable.
const MODEL = Deno.env.get("LEER_COTIZACION_MODEL") ?? Deno.env.get("ASSISTANT_MODEL") ?? "claude-haiku-4-5-20251001";
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

const MIMES_IMAGEN = new Set(["image/jpeg", "image/png", "image/webp", "image/heic"]);

const SYSTEM = `Eres un extractor de datos de cotizaciones de proveedores (compras tecnológicas, República Dominicana).
Lees un PDF o una foto de una cotización y devuelves SOLO un objeto JSON válido, sin texto adicional, sin markdown.
Formato EXACTO:
{
  "proveedor": string|null,
  "fecha": "YYYY-MM-DD"|null,
  "moneda": string|null,
  "articulos": [ { "descripcion": string, "cantidad": number|null, "unidad": string|null, "precio": number|null } ],
  "itbis": number|null,
  "total": number|null,
  "confianza": { "<campo>": number }
}
Reglas:
- "articulos" es la lista de renglones/líneas de la cotización (cada producto o servicio cotizado).
- "precio" es el precio UNITARIO de ese renglón (no el subtotal de la línea), en la moneda de la cotización.
- Números con punto decimal, sin separador de miles, sin símbolos de moneda.
- moneda: usa "DOP", "USD" u otro código ISO si se identifica; si no, null.
- Si un campo no se ve o no aplica, ponlo en null (o [] para articulos) y su confianza en 0.
- "confianza" es 0..1 por cada campo de NIVEL SUPERIOR que SÍ leíste (proveedor, fecha, itbis, total, articulos).
- NO inventes artículos ni precios. Si dudas de un renglón, igual inclúyelo pero baja la confianza de "articulos".`;

async function leerParametro(svc: Any, clave: string, def: number): Promise<number> {
  const { data } = await svc.schema("sgc").from("parametros").select("valor").eq("clave", clave).maybeSingle();
  const n = data?.valor ? Number(data.valor) : NaN;
  return Number.isFinite(n) ? n : def;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Método no permitido" }, 405);
  if (!ANTHROPIC_API_KEY) return json({ ok: false, error: "Lectura de cotizaciones no configurada (sin API key)." }, 503);

  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace("Bearer ", "");
  if (!token) return json({ ok: false, error: "No autenticado" }, 401);

  // Cliente con el JWT del usuario para identificarlo (RLS); service role para escribir uso_ia.
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authHeader } } });
  const svc = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { data: userData } = await userClient.auth.getUser();
  const userId = userData?.user?.id;
  if (!userId) return json({ ok: false, error: "Sesión inválida" }, 401);

  // ── CI10 — consentimiento de IA explícito (Anthropic). Verificado en servidor. ──
  const { data: consentOk } = await userClient.schema("sgc").rpc("mi_consentimiento", { p_tipo: "ia" });
  if (!consentOk) {
    return json({
      ok: false,
      error: "Para leer la cotización con inteligencia artificial, primero actívalo en Perfil › Privacidad.",
      error_code: "sin_consentimiento_ia",
    }, 403);
  }

  let payload: Any;
  try { payload = await req.json(); } catch { return json({ ok: false, error: "Cuerpo inválido" }, 400); }
  const archivo = payload?.archivo;
  const data: string = String(archivo?.data ?? "");
  const mime: string = String(archivo?.mime ?? "");
  if (!data || !mime) return json({ ok: false, error: "Sin archivo para leer." }, 400);
  const esPdf = mime === "application/pdf";
  const esImagen = MIMES_IMAGEN.has(mime);
  if (!esPdf && !esImagen) return json({ ok: false, error: "Formato no soportado (usa PDF o una foto)." }, 400);

  // ── Rate limit: por usuario/hora y global/día (comparte parámetros con leer_recibo
  //    por simplicidad operativa, pero contados por función — mismo patrón). ──────────
  const limHora = await leerParametro(svc, "leer_cotizacion_limite_usuario_hora", 20);
  const limDia = await leerParametro(svc, "leer_cotizacion_limite_diario_global", 200);
  const haceUnaHora = new Date(Date.now() - 3600_000).toISOString();
  const inicioDia = new Date(); inicioDia.setHours(0, 0, 0, 0);
  const [{ count: usoHora }, { count: usoDia }] = await Promise.all([
    svc.schema("sgc").from("uso_ia").select("id", { count: "exact", head: true })
      .eq("funcion", "leer_cotizacion").eq("usuario_id", userId).gte("created_at", haceUnaHora),
    svc.schema("sgc").from("uso_ia").select("id", { count: "exact", head: true })
      .eq("funcion", "leer_cotizacion").gte("created_at", inicioDia.toISOString()),
  ]);
  if ((usoHora ?? 0) >= limHora) return json({ ok: false, error: "Alcanzaste el límite de lecturas por hora. Escribe los artículos a mano." }, 429);
  if ((usoDia ?? 0) >= limDia) return json({ ok: false, error: "Se alcanzó el límite diario de lecturas del sistema. Escribe los artículos a mano." }, 429);

  // ── Construir el mensaje (document para PDF, image para foto) ───────────────
  const content: Any[] = [
    esPdf
      ? { type: "document", source: { type: "base64", media_type: "application/pdf", data } }
      : { type: "image", source: { type: "base64", media_type: mime, data } },
    { type: "text", text: "Lee esta cotización de un proveedor y devuelve SOLO el JSON con proveedor, fecha, moneda, artículos, itbis, total y su confianza." },
  ];

  let anthRes: Response;
  try {
    anthRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: MODEL, max_tokens: 2048, system: SYSTEM, messages: [{ role: "user", content }] }),
    });
  } catch (_e) {
    return json({ ok: false, error: "No se pudo leer la cotización (red)." }, 502);
  }
  if (!anthRes.ok) {
    const t = await anthRes.text();
    console.error("anthropic error", anthRes.status, t.slice(0, 300));
    return json({ ok: false, error: "El lector de cotizaciones no está disponible ahora." }, 502);
  }
  const anth = await anthRes.json();
  const texto: string = (anth?.content ?? []).map((c: Any) => c?.text ?? "").join("").trim();
  const inTok = anth?.usage?.input_tokens ?? 0;
  const outTok = anth?.usage?.output_tokens ?? 0;
  const costoUsd = inTok * PRECIO_IN + outTok * PRECIO_OUT;

  // Parsear el JSON (tolerante a ```json ... ``` o texto alrededor).
  let lectura: Any = null;
  try {
    const m = texto.match(/\{[\s\S]*\}/);
    lectura = m ? JSON.parse(m[0]) : null;
  } catch { lectura = null; }

  // Registrar uso (best-effort).
  try {
    await svc.schema("sgc").from("uso_ia").insert({
      usuario_id: userId, funcion: "leer_cotizacion", modelo: MODEL,
      tokens_in: inTok, tokens_out: outTok,
      costo_estimado: costoUsd,
      meta: { mime },
    });
  } catch (e) { console.error("uso_ia insert", e); }

  if (!lectura) return json({ ok: false, error: "No se pudo interpretar la cotización. Escribe los artículos a mano." }, 200);

  const confianza = lectura.confianza ?? {};
  delete lectura.confianza;
  if (!Array.isArray(lectura.articulos)) lectura.articulos = [];
  return json({ ok: true, lectura, confianza, modelo: MODEL, costo_usd: costoUsd });
});
