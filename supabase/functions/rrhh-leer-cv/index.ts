import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { envRequerido } from "../_shared/env.ts";
import { llamarClaude, ErrorClaude } from "../_shared/claude.ts";
import { construirContenidoCv, parsearCv, SYSTEM_RRHH_CV } from "./lector.ts";

// ============================================================================
// DO-06 (ronda DO, 12-nov-2026) — CV leído por IA: sube → la IA extrae campos
// estructurados → se guardan en sgc.rrhh_candidatos.cv_extraido. Mismo patrón
// async/polling que leer-documento-flota (DB3): el RPC `rrhh_candidato_lectura_crear`
// crea esta fila y dispara la edge en segundo plano (pg_net, x-sync-secret);
// el navegador hace polling de `rrhh_candidatos_lecturas`, nunca sostiene una
// llamada larga.
//
// Privacidad (DN-28): esta extracción es de un solo propósito, dentro de este
// edge function — NO se expone al chat de Compa ni al MCP general (misma
// distinción que ya aplica a leer-documento-flota). Ver docs/DATOS-Y-TERCEROS.md.
//
//   Entrada (POST, server-to-server): { job_id, candidato_id, usuario_id, archivo: {data, mime} }
//   Efecto: escribe estado='listo'|'error' en la fila del trabajo Y, si fue bien,
//   guarda el resultado en rrhh_candidatos.cv_extraido.
//
//   Secrets: ANTHROPIC_API_KEY · RRHH_LEER_CV_MODEL (opcional) · INFRA_SYNC_SECRET.
// ============================================================================

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const MODEL = Deno.env.get("RRHH_LEER_CV_MODEL") ?? Deno.env.get("ASSISTANT_MODEL") ?? "claude-haiku-4-5-20251001";
const SUPABASE_URL = envRequerido("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const PRECIO_IN = 1.0 / 1_000_000;
const PRECIO_OUT = 5.0 / 1_000_000;

Deno.serve(async (req) => {
  function json(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  }
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);

  const secret = req.headers.get("x-sync-secret");
  const expected = Deno.env.get("INFRA_SYNC_SECRET");
  if (!expected || secret !== expected) return json({ error: "No autorizado." }, 401);

  const svc = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { db: { schema: "sgc" } });

  // deno-lint-ignore no-explicit-any
  let payload: any;
  try { payload = await req.json(); } catch { return json({ error: "Cuerpo inválido" }, 400); }
  const jobId = String(payload?.job_id ?? "");
  const candidatoId = String(payload?.candidato_id ?? "") || null;
  const usuarioId = String(payload?.usuario_id ?? "") || null;
  const archivo = payload?.archivo && typeof payload.archivo === "object"
    ? { data: String(payload.archivo.data ?? ""), mime: String(payload.archivo.mime ?? "") }
    : null;
  if (!jobId) return json({ error: "Falta job_id." }, 400);

  const marcarError = async (msg: string) => {
    await svc.from("rrhh_candidatos_lecturas").update({ estado: "error", resultado: { error: msg } }).eq("id", jobId);
  };

  if (!ANTHROPIC_API_KEY) { await marcarError("Lectura de CV no configurada (sin API key)."); return json({ ok: false }); }
  if (!candidatoId) { await marcarError("Falta el candidato."); return json({ ok: false }); }
  if (!archivo?.data) { await marcarError("Sin archivo para leer."); return json({ ok: false }); }

  // deno-lint-ignore no-explicit-any
  let content: any[];
  try {
    content = construirContenidoCv(archivo);
  } catch (e) {
    await marcarError(e instanceof Error ? e.message : "Archivo no válido.");
    return json({ ok: false });
  }

  let texto: string;
  let tokensIn = 0, tokensOut = 0;
  try {
    const r = await llamarClaude({
      apiKey: ANTHROPIC_API_KEY,
      modelo: MODEL,
      system: SYSTEM_RRHH_CV,
      mensajes: [{ role: "user", content }],
      maxTokens: 1024,
    });
    texto = r.texto;
    tokensIn = r.tokensIn;
    tokensOut = r.tokensOut;
  } catch (e) {
    console.error("rrhh-leer-cv llamarClaude", e);
    const msg = e instanceof ErrorClaude ? "El lector de CV no está disponible ahora." : "No se pudo leer el CV (red).";
    await marcarError(msg);
    return json({ ok: false });
  }

  const costoUsd = tokensIn * PRECIO_IN + tokensOut * PRECIO_OUT;
  try {
    await svc.from("uso_ia").insert({
      usuario_id: usuarioId, funcion: "rrhh_leer_cv", modelo: MODEL,
      tokens_in: tokensIn, tokens_out: tokensOut, costo_estimado: costoUsd,
      meta: { candidato_id: candidatoId, mime: archivo.mime },
    });
  } catch (e) { console.error("uso_ia insert", e); }

  const extraido = parsearCv(texto);
  if (!extraido) {
    await marcarError("No se pudo interpretar el CV. Llena los campos a mano.");
    return json({ ok: false });
  }

  // AT11 — el resultado se guarda donde el usuario ya puede verlo (ficha del candidato).
  try {
    await svc.from("rrhh_candidatos").update({ cv_extraido: extraido }).eq("id", candidatoId);
  } catch (e) {
    console.error("rrhh_candidatos.cv_extraido update", e);
    await marcarError("Se leyó el CV pero no se pudo guardar en el candidato.");
    return json({ ok: false });
  }

  await svc.from("rrhh_candidatos_lecturas").update({
    estado: "listo",
    resultado: { extraido, modelo: MODEL, costo_usd: costoUsd },
  }).eq("id", jobId);

  return json({ ok: true });
});
