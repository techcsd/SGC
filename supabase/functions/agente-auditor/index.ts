import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { envRequerido } from "../_shared/env.ts";

// ============================================================================
// DF2 — Agente Auditor (Nivel 1, solo observa). Invocado manualmente por un
// usuario admin/tecnología (F5 lo disparará desde la oficina isométrica; sin
// cron fijo todavía — DF-07 deja "los otros según necesidad"). 100%
// determinista, sin IA, sin costo.
//
// Audita consistencia de datos del esquema sgc: tablas con RLS activado pero
// SIN ninguna policy (quedarían cerradas a cal y canto o abiertas según el
// default, según el caso — ambos son un bug real que ya pasó en este repo,
// ver CLAUDE.md "permission denied for schema sgc"). Nunca actúa — solo
// registra hallazgos (Nivel 1).
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
    return json({ error: "Solo Administración o Tecnología pueden correr al Auditor.", error_code: "no_autorizado" }, 403);
  }

  const svc = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { db: { schema: "sgc" } });

  const { data: agente } = await svc.from("agentes").select("id").eq("clave", "auditor").maybeSingle();
  const agenteId: string | null = agente?.id ?? null;

  const hallazgos: { titulo: string; detalle: string }[] = [];

  // Tablas con RLS activado pero sin ninguna policy — bug real recurrente del repo.
  const { data: sinPolicy, error: errSinPolicy } = await svc.rpc("agente_auditor_rls_sin_policy");
  if (errSinPolicy) {
    console.error("agente-auditor: rls_sin_policy", errSinPolicy);
  } else {
    for (const row of (sinPolicy ?? []) as { tabla: string }[]) {
      hallazgos.push({
        titulo: `Tabla sgc.${row.tabla} tiene RLS activado sin ninguna policy`,
        detalle: "Puede estar cerrada a todos (incluido service_role vía PostgREST) o abierta según el default — revisar.",
      });
    }
  }

  for (const h of hallazgos) {
    if (agenteId) {
      await svc.from("agente_hallazgos").insert({
        agente_id: agenteId, severidad: "media", titulo: h.titulo, detalle: h.detalle, origen: "pg_catalog",
      });
    }
  }

  if (agenteId) {
    await svc.from("agente_eventos").insert({
      agente_id: agenteId, tipo: "auditoria", estado: hallazgos.length ? "esperando_ok" : "observando",
      resumen: hallazgos.length ? `${hallazgos.length} inconsistencia(s) de RLS encontrada(s).` : "Sin inconsistencias de RLS.",
      evidencia_json: { hallazgos: hallazgos.length },
    });
  }

  return json({ ok: true, hallazgos });
});
