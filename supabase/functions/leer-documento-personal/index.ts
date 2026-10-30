import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders as construirCors } from "../_shared/cors.ts";
import { envRequerido } from "../_shared/env.ts";
import { construirContenido, parsearLectura, SYSTEM, type Any } from "./lector.ts";

// ============================================================================
// DB5 (Ronda DB) — Registro rápido de personal de obra con 2 fotos: el documento
// y la persona con el documento junto a la cara. Devuelve los campos del alta
// (nombre, apellido, tipo y número de documento, nacionalidad…) + un veredicto
// de coincidencia cara↔documento. Los campos PRECARGAN el formulario (editable,
// nada se guarda solo); las fotos se guardan como las fotos tipadas de siempre
// (`documento`, `persona_carnet_cedula`). **No se guarda ninguna transcripción
// fuera de los campos del registro** (CI13/riesgo 8 del contexto).
// Patrón leer-cotizacion: consentimiento CI10, rate limit, uso_ia.
//
//   Entrada: { foto_documento: {data, mime}, foto_persona: {data, mime} }
//   Salida:  { ok, lectura: { nombre, apellido, tipo_documento, documento_numero,
//              nacionalidad, fecha_nacimiento, sexo, coincide_rostro, confianza },
//              modelo, costo_usd }
// ============================================================================

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const MODEL = Deno.env.get("LEER_DOCUMENTO_PERSONAL_MODEL") ?? Deno.env.get("ASSISTANT_MODEL") ?? "claude-haiku-4-5-20251001";
const SUPABASE_URL = envRequerido("SUPABASE_URL");
const SUPABASE_ANON_KEY = envRequerido("SUPABASE_ANON_KEY");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const PRECIO_IN = 1.0 / 1_000_000;
const PRECIO_OUT = 5.0 / 1_000_000;

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
  if (!ANTHROPIC_API_KEY) return json({ ok: false, error: "Lectura de documentos no configurada (sin API key)." }, 503);

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.replace("Bearer ", "")) return json({ ok: false, error: "No autenticado", error_code: "no_auth" }, 401);

  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authHeader } } });
  const svc = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { data: userData } = await userClient.auth.getUser();
  const userId = userData?.user?.id;
  if (!userId) return json({ ok: false, error: "Sesión inválida", error_code: "sesion_invalida" }, 401);

  const { data: consentOk } = await userClient.schema("sgc").rpc("mi_consentimiento", { p_tipo: "ia" });
  if (!consentOk) {
    return json({
      ok: false,
      error: "Para leer el documento con inteligencia artificial, primero actívalo en Perfil › Privacidad.",
      error_code: "sin_consentimiento_ia",
    }, 403);
  }

  let payload: Any;
  try { payload = await req.json(); } catch { return json({ ok: false, error: "Cuerpo inválido" }, 400); }

  const limHora = await leerParametro(svc, "leer_documento_personal_limite_usuario_hora", 30);
  const limDia = await leerParametro(svc, "leer_documento_personal_limite_diario_global", 300);
  const haceUnaHora = new Date(Date.now() - 3600_000).toISOString();
  const inicioDia = new Date(); inicioDia.setHours(0, 0, 0, 0);
  const [{ count: usoHora }, { count: usoDia }] = await Promise.all([
    svc.schema("sgc").from("uso_ia").select("id", { count: "exact", head: true })
      .eq("funcion", "leer_documento_personal").eq("usuario_id", userId).gte("created_at", haceUnaHora),
    svc.schema("sgc").from("uso_ia").select("id", { count: "exact", head: true })
      .eq("funcion", "leer_documento_personal").gte("created_at", inicioDia.toISOString()),
  ]);
  if ((usoHora ?? 0) >= limHora) return json({ ok: false, error: "Alcanzaste el límite de lecturas por hora. Llena los campos a mano." }, 429);
  if ((usoDia ?? 0) >= limDia) return json({ ok: false, error: "Se alcanzó el límite diario de lecturas del sistema. Llena los campos a mano." }, 429);

  let content: Any[];
  try {
    content = construirContenido(
      { data: String(payload?.foto_documento?.data ?? ""), mime: String(payload?.foto_documento?.mime ?? "") },
      { data: String(payload?.foto_persona?.data ?? ""), mime: String(payload?.foto_persona?.mime ?? "") },
    );
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : "Fotos no válidas." }, 400);
  }

  let anthRes: Response;
  try {
    anthRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: MODEL, max_tokens: 1024, system: SYSTEM, messages: [{ role: "user", content }] }),
    });
  } catch (_e) {
    return json({ ok: false, error: "No se pudo leer el documento (red)." }, 502);
  }
  if (!anthRes.ok) {
    const t = await anthRes.text();
    console.error("anthropic error", anthRes.status, t.slice(0, 300));
    return json({ ok: false, error: "El lector de documentos no está disponible ahora." }, 502);
  }
  const anth = await anthRes.json();
  const texto: string = (anth?.content ?? []).map((c: Any) => c?.text ?? "").join("").trim();
  const inTok = anth?.usage?.input_tokens ?? 0;
  const outTok = anth?.usage?.output_tokens ?? 0;
  const costoUsd = inTok * PRECIO_IN + outTok * PRECIO_OUT;

  // uso_ia: solo metadatos (NUNCA la transcripción ni el número de documento).
  try {
    await svc.schema("sgc").from("uso_ia").insert({
      usuario_id: userId, funcion: "leer_documento_personal", modelo: MODEL,
      tokens_in: inTok, tokens_out: outTok, costo_estimado: costoUsd, meta: {},
    });
  } catch (e) { console.error("uso_ia insert", e); }

  const lectura = parsearLectura(texto);
  if (!lectura) return json({ ok: false, error: "No se pudo leer el documento. Llena los campos a mano." }, 200);
  return json({ ok: true, lectura, modelo: MODEL, costo_usd: costoUsd });
});
