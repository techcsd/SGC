import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders as construirCors } from "../_shared/cors.ts";
import { envRequerido } from "../_shared/env.ts";

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
//     { imagenes: [{ tipo: 'recibo'|'tablero'|'bomba'|'factura', data: '<base64>', mime: 'image/jpeg' }],
//       contexto?: 'combustible' | 'factura_general' }
//   Salida (contexto 'combustible', default — compatibilidad total con lo existente):
//     { ok, lectura: { monto, galones, precio_galon, producto, numero_recibo, fecha,
//                      hora, estacion, ncf, bomba, tarjeta_ult4, km, horas },
//       confianza: { <campo>: 0..1 }, modelo }
//   Salida (contexto 'factura_general' — DF2b, F2b):
//     { ok, lectura: { proveedor, rnc, ncf, fecha, subtotal, itbis, total, concepto, numero_recibo },
//       confianza: { <campo>: 0..1 }, modelo }
//
//   Secrets: ANTHROPIC_API_KEY (obligatorio) · LEER_RECIBO_MODEL (opcional).
// ============================================================================

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
// Haiku 4.5 soporta visión y es barato; configurable.
const MODEL = Deno.env.get("LEER_RECIBO_MODEL") ?? Deno.env.get("ASSISTANT_MODEL") ?? "claude-haiku-4-5-20251001";
const SUPABASE_URL = envRequerido("SUPABASE_URL");
const SUPABASE_ANON_KEY = envRequerido("SUPABASE_ANON_KEY");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Precio aproximado (USD/1M tokens) para el costo estimado — Haiku 4.5.
const PRECIO_IN = 1.0 / 1_000_000;
const PRECIO_OUT = 5.0 / 1_000_000;

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

// F2b (ronda DF) — contexto 'factura_general': factura/recibo de compra genérico,
// no de combustible. RNC/NCF son de uso fiscal en República Dominicana.
const SYSTEM_FACTURA = `Eres un extractor de datos de facturas y recibos de compra de la República Dominicana.
Lees imágenes de facturas/recibos y devuelves SOLO un objeto JSON válido, sin texto adicional, sin markdown.
Formato EXACTO:
{
  "proveedor": string|null, "rnc": string|null, "ncf": string|null, "fecha": "YYYY-MM-DD"|null,
  "subtotal": number|null, "itbis": number|null, "total": number|null,
  "concepto": string|null, "numero_recibo": string|null,
  "confianza": { "<campo>": number }
}
Reglas:
- "rnc" es el Registro Nacional del Contribuyente del proveedor (9 u 11 dígitos, puede llevar guiones en la factura pero devuélvelo solo con dígitos).
- "ncf" es el Número de Comprobante Fiscal (formato tipo B0100000001 o E310000000001).
- Números con punto decimal, sin separador de miles, sin símbolos de moneda.
- "concepto" es una descripción corta de qué se compró (ej. "Materiales de plomería", "Servicio de grúa").
- Si un campo no se ve o no aplica, ponlo en null y su confianza en 0.
- NO inventes. Si dudas, confianza baja. Si la foto no es una factura/recibo legible, todo en null con confianza 0.`;

const TIPO_INSTRUCCION_FACTURA: Record<string, string> = {
  factura: "Es la FOTO DE UNA FACTURA O RECIBO DE COMPRA. Extrae: proveedor, RNC, NCF, fecha, subtotal, ITBIS, total, concepto y número de recibo/factura.",
};

async function leerParametro(svc: Any, clave: string, def: number): Promise<number> {
  const { data } = await svc.schema("sgc").from("parametros").select("valor").eq("clave", clave).maybeSingle();
  const n = data?.valor ? Number(data.valor) : NaN;
  return Number.isFinite(n) ? n : def;
}

Deno.serve(async (req) => {
  const corsHeaders = construirCors(req);
  function json(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
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

  // ── CI10 — consentimiento de IA explícito (Anthropic). Verificado en servidor. ──
  const { data: consentOk } = await userClient.schema("sgc").rpc("mi_consentimiento", { p_tipo: "ia" });
  if (!consentOk) {
    return json({
      ok: false,
      error: "Para leer recibos con inteligencia artificial, primero actívalo en Perfil › Privacidad.",
      error_code: "sin_consentimiento_ia",
    }, 403);
  }

  let payload: Any;
  try { payload = await req.json(); } catch { return json({ ok: false, error: "Cuerpo inválido" }, 400); }
  const imagenes: Any[] = Array.isArray(payload?.imagenes) ? payload.imagenes : [];
  const contexto: "combustible" | "factura_general" = payload?.contexto === "factura_general" ? "factura_general" : "combustible";
  if (!imagenes.length) return json({ ok: false, error: "Sin imágenes para leer." }, 400);
  if (imagenes.length > 4) return json({ ok: false, error: "Máximo 4 imágenes por lectura." }, 400);

  // ── Rate limit: por usuario/hora y global/día (compartido entre contextos) ──
  const funcionUso = contexto === "factura_general" ? "leer_recibo_factura_general" : "leer_recibo";
  const limHora = await leerParametro(svc, "leer_recibo_limite_usuario_hora", 30);
  const limDia = await leerParametro(svc, "leer_recibo_limite_diario_global", 400);
  const haceUnaHora = new Date(Date.now() - 3600_000).toISOString();
  const inicioDia = new Date(); inicioDia.setHours(0, 0, 0, 0);
  const [{ count: usoHora }, { count: usoDia }] = await Promise.all([
    svc.schema("sgc").from("uso_ia").select("id", { count: "exact", head: true })
      .eq("funcion", funcionUso).eq("usuario_id", userId).gte("created_at", haceUnaHora),
    svc.schema("sgc").from("uso_ia").select("id", { count: "exact", head: true })
      .eq("funcion", funcionUso).gte("created_at", inicioDia.toISOString()),
  ]);
  if ((usoHora ?? 0) >= limHora) return json({ ok: false, error: "Alcanzaste el límite de lecturas por hora. Escribe los datos a mano." }, 429);
  if ((usoDia ?? 0) >= limDia) return json({ ok: false, error: "Se alcanzó el límite diario de lecturas del sistema. Escribe los datos a mano." }, 429);

  // ── Construir el mensaje de visión (DF2b — instrucción/sistema según contexto) ──
  const instrucciones = contexto === "factura_general" ? TIPO_INSTRUCCION_FACTURA : TIPO_INSTRUCCION;
  const systemPrompt = contexto === "factura_general" ? SYSTEM_FACTURA : SYSTEM;
  const content: Any[] = [];
  for (const img of imagenes) {
    const tipo = String(img?.tipo ?? (contexto === "factura_general" ? "factura" : "recibo"));
    const data = String(img?.data ?? "");
    const mime = String(img?.mime ?? "image/jpeg");
    if (!data) continue;
    content.push({ type: "text", text: instrucciones[tipo] ?? instrucciones.recibo ?? instrucciones.factura });
    content.push({ type: "image", source: { type: "base64", media_type: mime, data } });
  }
  content.push({ type: "text", text: "Devuelve SOLO el JSON con los campos leídos y su confianza." });

  // DI10/DI-19 — hasta 2 intentos: 1 reintento si la respuesta vino truncada
  // (stop_reason 'max_tokens') o el JSON no se pudo interpretar. Se registra la
  // respuesta cruda en el log cuando falla, para poder diagnosticar (mismo
  // patrón que debió existir para "Resumir para ronda", DH1).
  let anth: Any = null;
  let texto = "";
  let stopReason = "";
  let inTok = 0, outTok = 0;
  let intentos = 0;
  const MAX_INTENTOS = 2;

  for (intentos = 1; intentos <= MAX_INTENTOS; intentos++) {
    let anthRes: Response;
    try {
      anthRes = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({ model: MODEL, max_tokens: 1536, system: systemPrompt, messages: [{ role: "user", content }] }),
      });
    } catch (_e) {
      if (intentos < MAX_INTENTOS) continue;
      return json({ ok: false, error: "No se pudo leer el recibo (red)." }, 502);
    }
    if (!anthRes.ok) {
      const t = await anthRes.text();
      console.error("anthropic error", anthRes.status, t.slice(0, 300));
      if (intentos < MAX_INTENTOS) continue;
      return json({ ok: false, error: "El lector de recibos no está disponible ahora." }, 502);
    }
    anth = await anthRes.json();
    stopReason = String(anth?.stop_reason ?? "");
    texto = (anth?.content ?? []).map((c: Any) => c?.text ?? "").join("").trim();
    inTok += anth?.usage?.input_tokens ?? 0;
    outTok += anth?.usage?.output_tokens ?? 0;

    if (stopReason === "max_tokens") {
      console.error("leer-recibo: respuesta truncada (max_tokens)", { intento: intentos, texto: texto.slice(0, 500) });
      if (intentos < MAX_INTENTOS) continue;
      break;
    }
    break;
  }

  // Parsear el JSON (tolerante a ```json ... ``` o texto alrededor).
  let lectura: Any = null;
  try {
    const m = texto.match(/\{[\s\S]*\}/);
    lectura = m ? JSON.parse(m[0]) : null;
  } catch { lectura = null; }

  if (!lectura && intentos === 1 && stopReason !== "max_tokens") {
    // JSON no interpretable en el primer intento (y no fue por truncamiento) → 1 reintento más.
    console.error("leer-recibo: JSON no interpretable, reintentando", { texto: texto.slice(0, 500) });
    try {
      const anthRes2 = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({ model: MODEL, max_tokens: 1536, system: systemPrompt, messages: [{ role: "user", content }] }),
      });
      if (anthRes2.ok) {
        const anth2 = await anthRes2.json();
        stopReason = String(anth2?.stop_reason ?? "");
        texto = (anth2?.content ?? []).map((c: Any) => c?.text ?? "").join("").trim();
        inTok += anth2?.usage?.input_tokens ?? 0;
        outTok += anth2?.usage?.output_tokens ?? 0;
        const m2 = texto.match(/\{[\s\S]*\}/);
        lectura = m2 ? JSON.parse(m2[0]) : null;
      }
    } catch (e) { console.error("leer-recibo: reintento falló", e); }
  }

  // Registrar uso (best-effort).
  try {
    await svc.schema("sgc").from("uso_ia").insert({
      usuario_id: userId, funcion: funcionUso, modelo: MODEL,
      tokens_in: inTok, tokens_out: outTok,
      costo_estimado: inTok * PRECIO_IN + outTok * PRECIO_OUT,
      meta: { imagenes: imagenes.map((i: Any) => i?.tipo ?? "recibo"), contexto, stop_reason: stopReason || undefined },
    });
  } catch (e) { console.error("uso_ia insert", e); }

  if (!lectura) {
    console.error("leer-recibo: no se pudo interpretar la respuesta", { stop_reason: stopReason, texto: texto.slice(0, 800) });
    const motivo = stopReason === "max_tokens"
      ? "La lectura quedó incompleta (demasiado detalle en la imagen). Prueba con menos fotos o escribe los datos a mano."
      : "No se pudo interpretar la foto (borrosa, sin señal clara, o sin datos legibles). Escribe los datos a mano.";
    return json({ ok: false, error: motivo }, 200);
  }

  const confianza = lectura.confianza ?? {};
  delete lectura.confianza;
  return json({ ok: true, lectura, confianza, modelo: MODEL });
});
