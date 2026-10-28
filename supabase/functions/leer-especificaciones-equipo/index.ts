import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders as construirCors } from "../_shared/cors.ts";
import { envRequerido } from "../_shared/env.ts";

// ============================================================================
// DA9/DA-13 — Lee la captura de "Información del sistema"/"Acerca de" de
// Windows (hasta 3 imágenes) y devuelve un JSON con las specs de
// tec_equipo_specs + nombre_windows/usuario_windows. Calcado del patrón de
// `leer-cotizacion` (consentimiento IA, rate limit, uso_ia). La web SOLO
// precarga los campos para que la persona revise — nunca guarda sola.
//
//   Entrada (POST, JWT del usuario):
//     { archivos: [{ data: '<base64>', mime: 'image/jpeg'|'image/png'|'image/webp' }] } (máx 3)
//   Salida:
//     { ok, specs: {...campos de tec_equipo_specs...}, confianza, modelo, costo_usd }
//
//   Secrets: ANTHROPIC_API_KEY (obligatorio) · LEER_SPECS_EQUIPO_MODEL (opcional).
// ============================================================================

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const MODEL = Deno.env.get("LEER_SPECS_EQUIPO_MODEL") ?? Deno.env.get("ASSISTANT_MODEL") ?? "claude-haiku-4-5-20251001";
const SUPABASE_URL = envRequerido("SUPABASE_URL");
const SUPABASE_ANON_KEY = envRequerido("SUPABASE_ANON_KEY");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const PRECIO_IN = 1.0 / 1_000_000;
const PRECIO_OUT = 5.0 / 1_000_000;

// deno-lint-ignore no-explicit-any
type Any = any;

const MIMES_IMAGEN = new Set(["image/jpeg", "image/png", "image/webp", "image/heic"]);
const MAX_ARCHIVOS = 3;

const SYSTEM = `Eres un extractor de datos de capturas de pantalla de "Información del sistema"/"Acerca de" de Windows (o paneles equivalentes de especificaciones de una computadora).
Lees de 1 a 3 imágenes y devuelves SOLO un objeto JSON válido, sin texto adicional, sin markdown.
Formato EXACTO (usa null si un campo no aparece en ninguna imagen):
{
  "procesador": string|null,
  "ram_gb": number|null,
  "almacenamiento_tipo": "SSD"|"HDD"|"NVMe"|null,
  "almacenamiento_gb": number|null,
  "so": string|null,
  "so_version": string|null,
  "nombre_windows": string|null,
  "usuario_windows": string|null,
  "service_tag": string|null,
  "confianza": { "<campo>": number }
}
Reglas:
- "nombre_windows" es el nombre del equipo (ej. "CSD-CONT", "LENOVO-ENG"), visible en "Nombre de PC" o "Device name".
- "usuario_windows" es la cuenta con sesión iniciada (ej. "felipe scheker"), si aparece.
- "service_tag" solo si la imagen trae una etiqueta Dell/Lenovo (Service Tag, Serial Number, Plan ID).
- Números sin separador de miles. "confianza" es 0..1 por cada campo de NIVEL SUPERIOR que SÍ leíste.
- NO inventes datos. Si dudas, igual pon el valor pero baja su confianza.`;

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
  if (!ANTHROPIC_API_KEY) return json({ ok: false, error: "Lectura de especificaciones no configurada (sin API key)." }, 503);

  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace("Bearer ", "");
  if (!token) return json({ ok: false, error: "No autenticado" }, 401);

  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authHeader } } });
  const svc = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { data: userData } = await userClient.auth.getUser();
  const userId = userData?.user?.id;
  if (!userId) return json({ ok: false, error: "Sesión inválida" }, 401);

  // CI10 — consentimiento de IA explícito (mismo gate que leer-cotizacion/leer-recibo).
  const { data: consentOk } = await userClient.schema("sgc").rpc("mi_consentimiento", { p_tipo: "ia" });
  if (!consentOk) {
    return json({
      ok: false,
      error: "Para leer la captura con inteligencia artificial, primero actívalo en Perfil › Privacidad.",
      error_code: "sin_consentimiento_ia",
    }, 403);
  }

  let payload: Any;
  try { payload = await req.json(); } catch { return json({ ok: false, error: "Cuerpo inválido" }, 400); }
  const archivos: Any[] = Array.isArray(payload?.archivos) ? payload.archivos : [];
  if (!archivos.length) return json({ ok: false, error: "Sin archivo para leer." }, 400);
  if (archivos.length > MAX_ARCHIVOS) return json({ ok: false, error: `Máximo ${MAX_ARCHIVOS} capturas por vez.` }, 400);
  for (const a of archivos) {
    if (!a?.data || !MIMES_IMAGEN.has(a?.mime)) return json({ ok: false, error: "Formato no soportado (usa foto/captura JPG, PNG o WEBP)." }, 400);
  }

  // ── Rate limit (mismo patrón que leer-cotizacion) ───────────────────────
  const limHora = await leerParametro(svc, "leer_specs_equipo_limite_usuario_hora", 20);
  const limDia = await leerParametro(svc, "leer_specs_equipo_limite_diario_global", 200);
  const haceUnaHora = new Date(Date.now() - 3600_000).toISOString();
  const inicioDia = new Date(); inicioDia.setHours(0, 0, 0, 0);
  const [{ count: usoHora }, { count: usoDia }] = await Promise.all([
    svc.schema("sgc").from("uso_ia").select("id", { count: "exact", head: true })
      .eq("funcion", "leer_specs_equipo").eq("usuario_id", userId).gte("created_at", haceUnaHora),
    svc.schema("sgc").from("uso_ia").select("id", { count: "exact", head: true })
      .eq("funcion", "leer_specs_equipo").gte("created_at", inicioDia.toISOString()),
  ]);
  if ((usoHora ?? 0) >= limHora) return json({ ok: false, error: "Alcanzaste el límite de lecturas por hora. Llena los campos a mano." }, 429);
  if ((usoDia ?? 0) >= limDia) return json({ ok: false, error: "Se alcanzó el límite diario de lecturas del sistema. Llena los campos a mano." }, 429);

  const content: Any[] = archivos.map((a) => ({ type: "image", source: { type: "base64", media_type: a.mime, data: a.data } }));
  content.push({ type: "text", text: "Lee esta(s) captura(s) de información del sistema de Windows y devuelve SOLO el JSON con las specs." });

  let anthRes: Response;
  try {
    anthRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: MODEL, max_tokens: 1024, system: SYSTEM, messages: [{ role: "user", content }] }),
    });
  } catch (_e) {
    return json({ ok: false, error: "No se pudo leer la captura (red)." }, 502);
  }
  if (!anthRes.ok) {
    const t = await anthRes.text();
    console.error("anthropic error", anthRes.status, t.slice(0, 300));
    return json({ ok: false, error: "El lector de especificaciones no está disponible ahora." }, 502);
  }
  const anth = await anthRes.json();
  const texto: string = (anth?.content ?? []).map((c: Any) => c?.text ?? "").join("").trim();
  const inTok = anth?.usage?.input_tokens ?? 0;
  const outTok = anth?.usage?.output_tokens ?? 0;
  const costoUsd = inTok * PRECIO_IN + outTok * PRECIO_OUT;

  let specs: Any = null;
  try {
    const m = texto.match(/\{[\s\S]*\}/);
    specs = m ? JSON.parse(m[0]) : null;
  } catch { specs = null; }

  try {
    await svc.schema("sgc").from("uso_ia").insert({
      usuario_id: userId, funcion: "leer_specs_equipo", modelo: MODEL,
      tokens_in: inTok, tokens_out: outTok, costo_estimado: costoUsd,
      meta: { archivos: archivos.length },
    });
  } catch (e) { console.error("uso_ia insert", e); }

  if (!specs) return json({ ok: false, error: "No se pudo interpretar la captura. Llena los campos a mano." }, 200);

  const confianza = specs.confianza ?? {};
  delete specs.confianza;
  return json({ ok: true, specs, confianza, modelo: MODEL, costo_usd: costoUsd });
});
