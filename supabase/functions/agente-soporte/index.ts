import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { envRequerido } from "../_shared/env.ts";
import { reporteSinResponder } from "../_shared/agentes-reglas.ts";

// ============================================================================
// DF2 — Agente Soporte (Nivel 1 por ahora en esta pasada). Invocado
// manualmente por admin/tecnología; sin cron fijo (DF-07: "según necesidad").
//
// Revisa sgc.reportes_usuario abiertos hace más de 48h sin respuesta_admin.
// "Escalar" no está en la lista cerrada de 4 acciones Nivel 2 (DF-09) — así
// que, para no inventar una acción fuera de la lista, el Soporte solo
// reporta el hallazgo (Nivel 1). Si Xaviel quiere que escale de verdad
// (p.ej. notificar a tecnología), hay que agregar esa acción explícitamente
// a sgc.agente_acciones_permitidas primero.
// ============================================================================

const SUPABASE_URL = envRequerido("SUPABASE_URL");
const SUPABASE_ANON_KEY = envRequerido("SUPABASE_ANON_KEY");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.replace("Bearer ", "")) return json({ error: "No autenticado", error_code: "no_auth" }, 401);
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authHeader } } });
  const { data: userData } = await userClient.auth.getUser();
  if (!userData?.user?.id) return json({ error: "Sesión inválida", error_code: "sesion_invalida" }, 401);

  const [{ data: esAdmin }, { data: esTec }] = await Promise.all([
    userClient.schema("sgc").rpc("is_admin"),
    userClient.schema("sgc").rpc("es_tecnologia"),
  ]);
  if (!esAdmin && !esTec) {
    return json({ error: "Solo Administración o Tecnología pueden correr a Soporte.", error_code: "no_autorizado" }, 403);
  }

  const svc = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { db: { schema: "sgc" } });
  const { data: agente } = await svc.from("agentes").select("id").eq("clave", "soporte").maybeSingle();
  const agenteId: string | null = agente?.id ?? null;

  const ahoraIso = new Date().toISOString();
  const { data: candidatos } = await svc
    .from("reportes_usuario")
    .select("id, asunto, created_at, estado, respuesta_admin")
    .eq("estado", "abierto")
    .order("created_at", { ascending: true })
    .limit(200);
  const sinResponder = (candidatos ?? [])
    .filter((r) => reporteSinResponder(r.estado, r.respuesta_admin, r.created_at, ahoraIso))
    .slice(0, 50);

  if (agenteId && sinResponder?.length) {
    await svc.from("agente_hallazgos").insert({
      agente_id: agenteId, severidad: "media",
      titulo: `${sinResponder.length} reporte(s) de soporte sin responder hace más de 48h`,
      detalle: sinResponder.map((r) => r.asunto).join(" · "),
      origen: "reportes_usuario",
    });
  }

  if (agenteId) {
    await svc.from("agente_eventos").insert({
      agente_id: agenteId, tipo: "revision_reportes", estado: sinResponder?.length ? "esperando_ok" : "observando",
      resumen: sinResponder?.length ? `${sinResponder.length} reporte(s) sin responder hace +48h.` : "Sin reportes atrasados.",
      evidencia_json: { sin_responder: sinResponder?.length ?? 0 },
    });
  }

  return json({ ok: true, sin_responder: sinResponder?.length ?? 0 });
});
