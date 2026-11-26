import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders as construirCors } from "../_shared/cors.ts";
import { envRequerido } from "../_shared/env.ts";
import { cuerpoErrorIA, envolverServe, ErrorIA, llamarAnthropic, registrarFalloIA } from "../_shared/anthropic.ts";
import { construirContenido, parsearLectura, SYSTEM, type Any } from "./lector.ts";

// ============================================================================
// EA2 — Fotos del personal de obra por LOTE tras importar el Excel. El navegador
// manda UNA imagen por llamada (cédula, pasaporte o persona con su documento) y esta
// edge devuelve solo lo necesario para EMPAREJARLA con una fila del listado:
//   { tipo_imagen, documento_numero, nombre, apellido, nacionalidad, confianza }.
// Quién es cada foto lo decide el front con una función pura y determinista
// (número exacto → nombre → anclaje); la IA solo lee. Falla por imagen, nunca el lote.
//
// Privacidad (CI13 / Ley 172-13): consentimiento de IA verificado AQUÍ en el servidor
// (403 sin_consentimiento_ia). NO se guarda la imagen ni la transcripción: `uso_ia`
// lleva solo metadatos (tokens/costo, meta vacío) y los logs nunca incluyen el contenido.
// La foto definitiva la sube el front al bucket PRIVADO `personal-obra` solo después de
// que el usuario confirma el import.
//
//   Entrada: { imagen: { data: <base64>, mime: "image/jpeg"|"image/png"|"image/webp" } }
//   Salida:  { ok, lectura: {...}, confianza_min, modelo, costo_usd }
// Parámetros (sgc.parametros): leer_cedulas_lote_limite_usuario_hora (300),
//   leer_cedulas_lote_limite_diario (600, global), leer_cedulas_confianza_min (0.85).
// ============================================================================

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const MODEL = Deno.env.get("LEER_CEDULAS_LOTE_MODEL") ?? Deno.env.get("LEER_DOCUMENTO_PERSONAL_MODEL") ?? Deno.env.get("ASSISTANT_MODEL") ?? "claude-haiku-4-5-20251001";
const SUPABASE_URL = envRequerido("SUPABASE_URL");
const SUPABASE_ANON_KEY = envRequerido("SUPABASE_ANON_KEY");
const SUPABASE_SERVICE_ROLE_KEY = envRequerido("SUPABASE_SERVICE_ROLE_KEY");

const FUNCION = "leer_cedulas_lote";
const PRECIO_IN = 1.0 / 1_000_000;
const PRECIO_OUT = 5.0 / 1_000_000;

async function leerParametro(svc: Any, clave: string, def: number): Promise<number> {
  const { data } = await svc.from("parametros").select("valor").eq("clave", clave).maybeSingle();
  const n = data?.valor ? Number(data.valor) : NaN;
  return Number.isFinite(n) ? n : def;
}

Deno.serve(envolverServe(FUNCION, async (req) => {
  const corsHeaders = construirCors(req);
  function json(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Método no permitido" }, 405);
  if (!ANTHROPIC_API_KEY) return json({ ok: false, error: "Lectura de documentos no configurada (sin API key).", error_code: "ia_error" }, 503);

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.replace("Bearer ", "")) return json({ ok: false, error: "No autenticado", error_code: "no_auth" }, 401);

  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authHeader } } });
  const svc = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { db: { schema: "sgc" } });
  const { data: userData } = await userClient.auth.getUser();
  const userId = userData?.user?.id;
  if (!userId) return json({ ok: false, error: "Sesión inválida", error_code: "sesion_invalida" }, 401);

  // CI10 — consentimiento de IA, verificado en el servidor (nunca solo en el cliente).
  const { data: consentOk } = await userClient.schema("sgc").rpc("mi_consentimiento", { p_tipo: "ia" });
  if (!consentOk) {
    return json({
      ok: false,
      error: "Para leer los documentos con inteligencia artificial, primero actívalo en Perfil › Privacidad.",
      error_code: "sin_consentimiento_ia",
    }, 403);
  }

  let payload: Any;
  try { payload = await req.json(); } catch { return json({ ok: false, error: "Cuerpo inválido", error_code: "cuerpo_invalido" }, 400); }

  // Validación ANTES de gastar cupo o llamar a la IA.
  let content: Any[];
  try {
    content = construirContenido({ data: String(payload?.imagen?.data ?? ""), mime: String(payload?.imagen?.mime ?? "") });
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : "Imagen no válida.", error_code: "imagen_invalida" }, 400);
  }

  const [limHora, limDia, confMin] = await Promise.all([
    leerParametro(svc, "leer_cedulas_lote_limite_usuario_hora", 300),
    leerParametro(svc, "leer_cedulas_lote_limite_diario", 600),
    leerParametro(svc, "leer_cedulas_confianza_min", 0.85),
  ]);
  const haceUnaHora = new Date(Date.now() - 3600_000).toISOString();
  const inicioDia = new Date(); inicioDia.setHours(0, 0, 0, 0);
  const [{ count: usoHora }, { count: usoDia }] = await Promise.all([
    svc.from("uso_ia").select("id", { count: "exact", head: true })
      .eq("funcion", FUNCION).eq("usuario_id", userId).gte("created_at", haceUnaHora),
    svc.from("uso_ia").select("id", { count: "exact", head: true })
      .eq("funcion", FUNCION).gte("created_at", inicioDia.toISOString()),
  ]);
  if ((usoHora ?? 0) >= limHora) {
    return json({ ok: false, error: "Alcanzaste el límite de imágenes leídas por hora. El resto queda «Sin asignar»: puedes continuar sin ellas o intentar más tarde.", error_code: "limite_hora" }, 429);
  }
  if ((usoDia ?? 0) >= limDia) {
    return json({ ok: false, error: "Se alcanzó el límite diario de lecturas del sistema. El resto queda «Sin asignar».", error_code: "limite_diario" }, 429);
  }

  let r;
  try {
    r = await llamarAnthropic(ANTHROPIC_API_KEY, { model: MODEL, max_tokens: 400, system: SYSTEM, messages: [{ role: "user", content }] });
  } catch (e) {
    if (e instanceof ErrorIA) {
      console.error("leer-cedulas-lote ia", e.codigo, e.status, e.requestId); // sin contenido
      // Solo los fallos SISTÉMICOS (crédito/modelo) se registran para Tecnología: un lote no debe inundar el log.
      if (e.codigo === "ia_sin_credito" || e.codigo === "ia_modelo_no_disponible") await registrarFalloIA(svc, userId, FUNCION, e, MODEL);
      return json(cuerpoErrorIA(e), 502);
    }
    throw e;
  }
  const costoUsd = r.tokensIn * PRECIO_IN + r.tokensOut * PRECIO_OUT;

  // uso_ia: SOLO metadatos (nunca la imagen, la transcripción ni el número de documento).
  try {
    await svc.from("uso_ia").insert({
      usuario_id: userId, funcion: FUNCION, modelo: MODEL,
      tokens_in: r.tokensIn, tokens_out: r.tokensOut, costo_estimado: costoUsd, meta: {},
    });
  } catch (_e) { console.error("uso_ia insert"); }

  const lectura = parsearLectura(r.texto);
  if (!lectura) return json({ ok: false, error: "No se pudo leer la imagen.", error_code: "lectura_ilegible" }, 200);
  return json({ ok: true, lectura, confianza_min: confMin, modelo: MODEL, costo_usd: costoUsd });
}, construirCors));
