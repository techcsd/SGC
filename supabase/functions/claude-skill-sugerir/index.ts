import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { envRequerido } from "../_shared/env.ts";
import { llamarClaude, ErrorClaude } from "../_shared/claude.ts";
import { construirPromptSugerir, parsearSugerencia, SYSTEM_SUGERIR_SKILL } from "./sugerir.ts";

// ============================================================================
// DO-10(e) (ronda DO, 12-nov-2026) — "Sugerir con IA" en Claude › Crear: a
// partir de "Qué hace"/"Cuándo usarla" + el rol de quien crea, propone un
// borrador editable de "Pasos"/"Ejemplo". La persona SIEMPRE revisa antes de
// guardar — nunca se publica solo.
//
// Privacidad (riesgo DO-10.7): el contexto que se le pasa a la IA (skills "ya
// publicadas para ese rol") se obtiene con un cliente de Supabase scoped al
// JWT del propio usuario (no service_role) — la RLS de claude_skills filtra
// automáticamente a lo que ESE usuario ya puede ver, así que nunca se filtran
// skills de otros roles/equipos sin acceso. Tampoco se incluye ningún nombre
// de persona en el prompt, solo nombre/descripción de skills.
//
//   Entrada (POST, usuario autenticado): { que_hace, cuando_usarla, roles: string[] }
//   Secrets: ANTHROPIC_API_KEY · CLAUDE_SKILL_SUGERIR_MODEL (opcional).
// ============================================================================

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const MODEL = Deno.env.get("CLAUDE_SKILL_SUGERIR_MODEL") ?? Deno.env.get("ASSISTANT_MODEL") ?? "claude-haiku-4-5-20251001";
const SUPABASE_URL = envRequerido("SUPABASE_URL");
const ANON_KEY = envRequerido("SUPABASE_ANON_KEY");

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ ok: false, error: "No autorizado." }, 401);
  const caller = createClient(SUPABASE_URL, ANON_KEY, { db: { schema: "sgc" }, global: { headers: { Authorization: authHeader } } });
  const { data: userData, error: userError } = await caller.auth.getUser();
  if (userError || !userData.user) return json({ ok: false, error: "No autorizado." }, 401);

  if (!ANTHROPIC_API_KEY) return json({ ok: false, error: "Sugerencia con IA no configurada (sin API key)." }, 500);

  // deno-lint-ignore no-explicit-any
  let payload: any;
  try { payload = await req.json(); } catch { return json({ ok: false, error: "Cuerpo inválido" }, 400); }
  const queHace = String(payload?.que_hace ?? "").slice(0, 1000);
  const cuandoUsarla = String(payload?.cuando_usarla ?? "").slice(0, 1000);
  const roles = Array.isArray(payload?.roles) ? payload.roles.map((r: unknown) => String(r)).slice(0, 10) : [];

  // RLS (vía el cliente scoped al usuario) ya filtra a lo que ESTE usuario puede ver.
  const { data: skillsVisibles } = await caller
    .from("claude_skills")
    .select("nombre, descripcion")
    .eq("estado", "publicada")
    .order("updated_at", { ascending: false })
    .limit(15);

  const prompt = construirPromptSugerir({ queHace, cuandoUsarla, roles, skillsVisibles: skillsVisibles ?? [] });

  let texto: string;
  try {
    const r = await llamarClaude({
      apiKey: ANTHROPIC_API_KEY,
      modelo: MODEL,
      system: SYSTEM_SUGERIR_SKILL,
      mensajes: [{ role: "user", content: prompt }],
      maxTokens: 800,
    });
    texto = r.texto;
    try {
      await caller.from("uso_ia").insert({
        usuario_id: userData.user.id, funcion: "claude_skill_sugerir", modelo: MODEL,
        tokens_in: r.tokensIn, tokens_out: r.tokensOut, costo_estimado: r.tokensIn * 1e-6 + r.tokensOut * 5e-6,
      });
    } catch (e) { console.error("uso_ia insert", e); }
  } catch (e) {
    console.error("claude-skill-sugerir llamarClaude", e);
    const msg = e instanceof ErrorClaude ? "El sugeridor no está disponible ahora." : "No se pudo generar la sugerencia (red).";
    return json({ ok: false, error: msg });
  }

  const sugerencia = parsearSugerencia(texto);
  if (!sugerencia) return json({ ok: false, error: "No se pudo generar una sugerencia interpretable." });

  return json({ ok: true, pasos: sugerencia.pasos, ejemplo: sugerencia.ejemplo });
});
