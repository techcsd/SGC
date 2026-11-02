import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { envRequerido } from "../_shared/env.ts";
import { obraSinBitacoraHoy } from "../_shared/agentes-reglas.ts";

// ============================================================================
// DF2 — Agente Capataz (Nivel 1 por ahora en esta pasada). Invocado
// manualmente por admin/tecnología; sin cron fijo (DF-07: "según necesidad").
//
// Revisa cobertura real: proyectos activos sin bitácora de hoy, pasadas las
// 3pm hora RD (mismo criterio que usa el cron `sgc-obra-avisos`, no inventa
// uno nuevo). Por ahora solo reporta hallazgo (Nivel 1) — ninguna de las 4
// acciones cerradas (DF-09) aplica a "recordar bitácora" (tocaría el dominio
// de bitácora, fuera de lo permitido), así que el Capataz no actúa todavía;
// queda documentado como pendiente de decisión de producto, no como olvido.
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
    return json({ error: "Solo Administración o Tecnología pueden correr al Capataz.", error_code: "no_autorizado" }, 403);
  }

  const svc = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { db: { schema: "sgc" } });
  const { data: agente } = await svc.from("agentes").select("id").eq("clave", "capataz").maybeSingle();
  const agenteId: string | null = agente?.id ?? null;

  const hoy = new Date().toISOString().slice(0, 10);
  const { data: proyectos } = await svc
    .from("proyectos")
    .select("id, nombre")
    .eq("activo", true)
    .is("cerrado_at", null);

  const { data: bitacorasHoy } = await svc.from("bitacoras").select("proyecto_id").eq("fecha", hoy);
  const conBitacora = new Set((bitacorasHoy ?? []).map((b) => b.proyecto_id));
  const sinBitacora = (proyectos ?? []).filter((p) => obraSinBitacoraHoy(p.id, conBitacora));

  if (agenteId && sinBitacora.length) {
    await svc.from("agente_hallazgos").insert({
      agente_id: agenteId, severidad: "baja",
      titulo: `${sinBitacora.length} obra(s) sin bitácora de hoy`,
      detalle: sinBitacora.map((p) => p.nombre).join(", "),
      origen: "bitacoras",
    });
  }

  if (agenteId) {
    await svc.from("agente_eventos").insert({
      agente_id: agenteId, tipo: "cobertura", estado: sinBitacora.length ? "esperando_ok" : "observando",
      resumen: sinBitacora.length ? `${sinBitacora.length} obra(s) sin bitácora hoy.` : "Todas las obras activas tienen bitácora hoy.",
      evidencia_json: { sin_bitacora: sinBitacora.length, total_activas: (proyectos ?? []).length },
    });
  }

  return json({ ok: true, sin_bitacora: sinBitacora.length });
});
