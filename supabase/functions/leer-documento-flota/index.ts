import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders as construirCors } from "../_shared/cors.ts";
import { envRequerido } from "../_shared/env.ts";
import { construirContenido, parsearPaginas, SYSTEM, type Any } from "./lector.ts";

// ============================================================================
// DB3 (Ronda DB) — Lector de documentos de FLOTA en lote: un PDF multipágina
// (p. ej. MARBETES.pdf con los 12 seguros SURA renovados) o hasta 20 fotos.
// Devuelve una lectura POR PÁGINA (tipo + campos + confianza); el emparejado
// con vehículos y la aplicación los hacen las RPC `flota_documentos_emparejar`
// y `flota_documentos_aplicar` (db8) — NADA se guarda sin revisión por fila.
// Calcado de `leer-cotizacion` (consentimiento CI10, rate limit, uso_ia).
//
//   Entrada (POST, JWT del usuario):
//     { archivos: [{ data: '<base64>', mime: 'application/pdf'|'image/*' }] }
//   Salida:
//     { ok, paginas: [{ pagina, tipo, campos, confianza }], modelo, costo_usd }
//
//   Secrets: ANTHROPIC_API_KEY · LEER_DOCUMENTO_FLOTA_MODEL (opcional).
// ============================================================================

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const MODEL = Deno.env.get("LEER_DOCUMENTO_FLOTA_MODEL") ?? Deno.env.get("ASSISTANT_MODEL") ?? "claude-haiku-4-5-20251001";
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
  const token = authHeader.replace("Bearer ", "");
  if (!token) return json({ ok: false, error: "No autenticado", error_code: "no_auth" }, 401);

  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authHeader } } });
  const svc = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { data: userData } = await userClient.auth.getUser();
  const userId = userData?.user?.id;
  if (!userId) return json({ ok: false, error: "Sesión inválida", error_code: "sesion_invalida" }, 401);

  // CI10 — consentimiento de IA verificado en servidor.
  const { data: consentOk } = await userClient.schema("sgc").rpc("mi_consentimiento", { p_tipo: "ia" });
  if (!consentOk) {
    return json({
      ok: false,
      error: "Para leer documentos con inteligencia artificial, primero actívalo en Perfil › Privacidad.",
      error_code: "sin_consentimiento_ia",
    }, 403);
  }

  let payload: Any;
  try { payload = await req.json(); } catch { return json({ ok: false, error: "Cuerpo inválido", error_code: "cuerpo_invalido" }, 400); }
  const archivos: { data: string; mime: string }[] = Array.isArray(payload?.archivos)
    ? payload.archivos.map((a: Any) => ({ data: String(a?.data ?? ""), mime: String(a?.mime ?? "") })).filter((a: Any) => a.data && a.mime)
    : [];
  if (!archivos.length) return json({ ok: false, error: "Sin archivos para leer." }, 400);

  // Rate limit por usuario/hora y global/día (parámetros propios de esta función).
  const limHora = await leerParametro(svc, "leer_documento_flota_limite_usuario_hora", 20);
  const limDia = await leerParametro(svc, "leer_documento_flota_limite_diario_global", 200);
  const haceUnaHora = new Date(Date.now() - 3600_000).toISOString();
  const inicioDia = new Date(); inicioDia.setHours(0, 0, 0, 0);
  const [{ count: usoHora }, { count: usoDia }] = await Promise.all([
    svc.schema("sgc").from("uso_ia").select("id", { count: "exact", head: true })
      .eq("funcion", "leer_documento_flota").eq("usuario_id", userId).gte("created_at", haceUnaHora),
    svc.schema("sgc").from("uso_ia").select("id", { count: "exact", head: true })
      .eq("funcion", "leer_documento_flota").gte("created_at", inicioDia.toISOString()),
  ]);
  if ((usoHora ?? 0) >= limHora) return json({ ok: false, error: "Alcanzaste el límite de lecturas por hora. Llena los campos a mano." }, 429);
  if ((usoDia ?? 0) >= limDia) return json({ ok: false, error: "Se alcanzó el límite diario de lecturas del sistema. Llena los campos a mano." }, 429);

  let content: Any[];
  try { content = construirContenido(archivos); } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : "Archivos no válidos." }, 400);
  }

  let anthRes: Response;
  try {
    anthRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      // 24 páginas × ~10 campos → respuesta larga; 8k tokens dan margen.
      body: JSON.stringify({ model: MODEL, max_tokens: 8192, system: SYSTEM, messages: [{ role: "user", content }] }),
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

  try {
    await svc.schema("sgc").from("uso_ia").insert({
      usuario_id: userId, funcion: "leer_documento_flota", modelo: MODEL,
      tokens_in: inTok, tokens_out: outTok, costo_estimado: costoUsd,
      meta: { archivos: archivos.length, mime: archivos[0].mime },
    });
  } catch (e) { console.error("uso_ia insert", e); }

  const paginas = parsearPaginas(texto);
  if (!paginas) return json({ ok: false, error: "No se pudo interpretar el documento. Llena los campos a mano." }, 200);

  return json({ ok: true, paginas, modelo: MODEL, costo_usd: costoUsd });
});
