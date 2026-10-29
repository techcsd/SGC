import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders as construirCors } from "../_shared/cors.ts";
import { envRequerido } from "../_shared/env.ts";
import { construirPromptUsuario, parsearResumen, SYSTEM, type Any, type ContextoReporte } from "./resumidor.ts";

// ============================================================================
// DB6 (Ronda DB) — Convierte un reporte de Soporte en (a) nota de ronda lista
// para copiar y (b) prompt de hotfix para Claude Code si aplica. El contexto se
// arma EN EL SERVIDOR (reporte + fotos + autor/roles/módulos + 3 resueltos
// parecidos con su respuesta_admin). Resultado → reportes_usuario.ia_resumen
// (no se regenera salvo `forzar`). Solo admin/Tecnología (gate del RPC db12).
//
//   Entrada: { reporte_id, forzar? }
//   Salida:  { ok, resumen: { resumen_ronda, es_hotfix, motivo, prompt_hotfix },
//              cacheado, modelo?, costo_usd? }
// ============================================================================

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const MODEL = Deno.env.get("RESUMIR_REPORTE_MODEL") ?? Deno.env.get("ASSISTANT_MODEL") ?? "claude-haiku-4-5-20251001";
const SUPABASE_URL = envRequerido("SUPABASE_URL");
const SUPABASE_ANON_KEY = envRequerido("SUPABASE_ANON_KEY");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PRECIO_IN = 1.0 / 1_000_000;
const PRECIO_OUT = 5.0 / 1_000_000;

Deno.serve(async (req) => {
  const corsHeaders = construirCors(req);
  function json(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Método no permitido" }, 405);
  if (!ANTHROPIC_API_KEY) return json({ ok: false, error: "El resumen con IA no está configurado (sin API key)." }, 503);

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.replace("Bearer ", "")) return json({ ok: false, error: "No autenticado", error_code: "no_auth" }, 401);
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authHeader } } });
  const svc = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { db: { schema: "sgc" } });
  const { data: userData } = await userClient.auth.getUser();
  const userId = userData?.user?.id;
  if (!userId) return json({ ok: false, error: "Sesión inválida", error_code: "sesion_invalida" }, 401);

  // Gate admin/tecnología (con el jwt del usuario; mismo gate que el RPC db12).
  const [{ data: esAdmin }, { data: esTec }] = await Promise.all([
    userClient.schema("sgc").rpc("is_admin"),
    userClient.schema("sgc").rpc("es_tecnologia"),
  ]);
  if (!esAdmin && !esTec) {
    return json({ ok: false, error: "Solo Administración o Tecnología pueden resumir reportes.", error_code: "no_autorizado" }, 403);
  }

  // CI10 — consentimiento de IA del usuario que pide el resumen.
  const { data: consentOk } = await userClient.schema("sgc").rpc("mi_consentimiento", { p_tipo: "ia" });
  if (!consentOk) {
    return json({
      ok: false,
      error: "Para resumir con inteligencia artificial, primero actívalo en Perfil › Privacidad.",
      error_code: "sin_consentimiento_ia",
    }, 403);
  }

  let payload: Any;
  try { payload = await req.json(); } catch { return json({ ok: false, error: "Cuerpo inválido" }, 400); }
  const reporteId = String(payload?.reporte_id ?? "");
  const forzar = payload?.forzar === true;
  if (!reporteId) return json({ ok: false, error: "Falta reporte_id." }, 400);

  const { data: rep, error: repErr } = await svc.from("reportes_usuario").select("*").eq("id", reporteId).single();
  if (repErr || !rep) return json({ ok: false, error: "Reporte no encontrado." }, 404);

  // Cache: si ya hay resumen y no piden regenerar, se devuelve el guardado.
  if (rep.ia_resumen && !forzar) return json({ ok: true, resumen: rep.ia_resumen, cacheado: true });

  // ── Contexto en servidor ──
  const { data: autor } = await svc.from("usuarios").select("id, nombre").eq("id", rep.usuario_id).maybeSingle();
  const { data: rolesRows } = await svc
    .from("usuarios_roles").select("rol:roles(codigo, modulos)").eq("usuario_id", rep.usuario_id);
  const roles = [...new Set(((rolesRows ?? []) as Any[]).map((r) => r.rol?.codigo).filter(Boolean))];
  const modulos = [...new Set(((rolesRows ?? []) as Any[]).flatMap((r) => r.rol?.modulos ?? []))];

  // 3 resueltos parecidos: comparten alguna palabra significativa del asunto; si no, los últimos 3.
  const palabras = String(rep.asunto ?? "").toUpperCase().split(/[^A-ZÁÉÍÓÚÑ0-9]+/).filter((w: string) => w.length >= 4).slice(0, 5);
  let parecidos: Any[] = [];
  if (palabras.length) {
    const or = palabras.map((w: string) => `asunto.ilike.%${w}%`).join(",");
    const { data } = await svc.from("reportes_usuario")
      .select("asunto, respuesta_admin, estado")
      .in("estado", ["resuelto", "descartado"]).neq("id", reporteId)
      .or(or).order("resuelto_en", { ascending: false }).limit(3);
    parecidos = (data ?? []) as Any[];
  }
  if (!parecidos.length) {
    const { data } = await svc.from("reportes_usuario")
      .select("asunto, respuesta_admin, estado")
      .eq("estado", "resuelto").neq("id", reporteId)
      .order("resuelto_en", { ascending: false }).limit(3);
    parecidos = (data ?? []) as Any[];
  }

  // Fotos (hasta 4) como imágenes.
  const { data: fotos } = await svc.from("reportes_usuario_fotos").select("storage_path").eq("reporte_id", reporteId).limit(4);
  const imagenes: Any[] = [];
  for (const f of (fotos ?? []) as Any[]) {
    try {
      const { data: blob } = await svc.storage.from("reportes").download(f.storage_path);
      if (!blob) continue;
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let bin = "";
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      const mime = f.storage_path.endsWith(".png") ? "image/png" : f.storage_path.endsWith(".webp") ? "image/webp" : "image/jpeg";
      imagenes.push({ type: "image", source: { type: "base64", media_type: mime, data: btoa(bin) } });
    } catch { /* foto ilegible: el resumen sale sin ella */ }
  }

  const ctx: ContextoReporte = {
    asunto: rep.asunto ?? "", descripcion: rep.descripcion ?? "", tipo: rep.tipo ?? "comentario",
    estado: rep.estado ?? "abierto", creado: String(rep.created_at ?? "").slice(0, 10),
    autor: { nombre: (autor as Any)?.nombre ?? "?", roles, modulos },
    fotos: imagenes.length,
    parecidos,
  };

  let anthRes: Response;
  try {
    anthRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: MODEL, max_tokens: 1500, system: SYSTEM,
        messages: [{ role: "user", content: [...imagenes, { type: "text", text: construirPromptUsuario(ctx) }] }],
      }),
    });
  } catch (_e) {
    return json({ ok: false, error: "No se pudo resumir (red)." }, 502);
  }
  if (!anthRes.ok) {
    console.error("anthropic error", anthRes.status, (await anthRes.text()).slice(0, 300));
    return json({ ok: false, error: "El resumen con IA no está disponible ahora." }, 502);
  }
  const anth = await anthRes.json();
  const texto: string = (anth?.content ?? []).map((c: Any) => c?.text ?? "").join("").trim();
  const inTok = anth?.usage?.input_tokens ?? 0;
  const outTok = anth?.usage?.output_tokens ?? 0;
  const costoUsd = inTok * PRECIO_IN + outTok * PRECIO_OUT;

  try {
    await svc.from("uso_ia").insert({
      usuario_id: userId, funcion: "resumir_reporte", modelo: MODEL,
      tokens_in: inTok, tokens_out: outTok, costo_estimado: costoUsd, meta: { reporte_id: reporteId },
    });
  } catch (e) { console.error("uso_ia insert", e); }

  const resumen = parsearResumen(texto);
  if (!resumen) return json({ ok: false, error: "No se pudo interpretar el resumen. Inténtalo de nuevo." }, 200);

  // Guardar con el gate del RPC (jwt del usuario — queda auditado como suyo).
  const { error: saveErr } = await userClient.schema("sgc").rpc("reporte_guardar_ia_resumen", {
    p_id: reporteId, p_resumen: resumen,
  });
  if (saveErr) console.error("guardar ia_resumen", saveErr.message);

  return json({ ok: true, resumen, cacheado: false, modelo: MODEL, costo_usd: costoUsd });
});
