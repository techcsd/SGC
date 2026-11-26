import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { envRequerido } from "../_shared/env.ts";
import {
  candidatosDeBarrido,
  candidatosDeErrores,
  candidatosDeReportes,
  deduplicar,
  estadoInicial,
  normalizarConfig,
  type CandidatoTarea,
  type ErrorFila,
  type ReporteFila,
} from "../_shared/agente-ingeniero-lib.ts";

// ============================================================================
// EA3 -- agente-ingeniero-cola. pg_cron cada 15 min (modo "cola") y martes/viernes
// 10:00 UTC = 6:00 am RD (modo "barrido"), con x-sync-secret (patron agente-vigia).
// 100% determinista: sin IA, sin costo. Solo LEE reportes/errores y ESCRIBE en
// sgc.agente_ingeniero_tareas. No toca tablas de negocio ni cierra reportes.
//
// Fuentes: sgc.reportes_usuario (abiertos, ultimos 14 dias), sgc.app_error_reports
// (ultimas 24 h; source 'app' y 'web' viven en la misma tabla). Se deduplica por
// (origen, origen_ref) contra la cola ya existente. Las sugerencias/funciones
// nuevas entran como 'propuesta' (plan para Xaviel, sin codigo).
// El texto de usuario se sanea y queda como DATO: nunca llega a un prompt sin encapsular.
// ============================================================================

const SUPABASE_URL = envRequerido("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Metodo no permitido" }, 405);
  const secret = req.headers.get("x-sync-secret");
  if (!secret || secret !== Deno.env.get("INFRA_SYNC_SECRET")) return json({ error: "No autorizado." }, 401);

  let modo = "cola";
  try {
    const b = await req.json();
    if (b?.modo === "barrido") modo = "barrido";
  } catch { /* cuerpo vacio = cola */ }

  const svc = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { db: { schema: "sgc" } });
  const { data: cfgRaw } = await svc.rpc("ing_config_leer");
  const cfg = normalizarConfig(cfgRaw);
  const ahora = new Date();

  let candidatos: CandidatoTarea[] = [];
  try {
    if (modo === "barrido") {
      // El barrido respeta el freno de emergencia y el tope de PR por barrido.
      if (!cfg.agentes_pausa_total && cfg.max_pr_barrido > 0) candidatos = candidatosDeBarrido(ahora, cfg);
    } else {
      const desdeReportes = new Date(ahora.getTime() - 14 * 86_400_000).toISOString();
      const desdeErrores = new Date(ahora.getTime() - 86_400_000).toISOString();
      const [{ data: reportes }, { data: errores }] = await Promise.all([
        svc.from("reportes_usuario").select("id, tipo, asunto, descripcion, created_at")
          .eq("estado", "abierto").gte("created_at", desdeReportes).order("created_at", { ascending: false }).limit(100),
        svc.from("app_error_reports").select("source, error_type, message, stack, platform, device_model")
          .gte("created_at", desdeErrores).order("created_at", { ascending: false }).limit(1000),
      ]);
      candidatos = [
        ...candidatosDeReportes((reportes ?? []) as ReporteFila[]),
        ...candidatosDeErrores((errores ?? []) as ErrorFila[]),
      ];
    }
  } catch (e) {
    console.error("agente-ingeniero-cola: fuentes", e);
    return json({ error: "No se pudieron leer las fuentes." }, 500);
  }

  // Dedupe contra la cola existente (el indice unico (origen, origen_ref) es la red final).
  const refs = candidatos.map((c) => c.origen_ref);
  const existentes = new Set<string>();
  if (refs.length) {
    const { data: ya } = await svc.from("agente_ingeniero_tareas").select("origen, origen_ref").in("origen_ref", refs);
    for (const f of ya ?? []) existentes.add(`${f.origen}|${f.origen_ref}`);
  }
  const nuevos = deduplicar(candidatos, existentes);

  let creadas = 0;
  let propuestas = 0;
  if (nuevos.length) {
    const filas = nuevos.map((c) => ({
      origen: c.origen, origen_ref: c.origen_ref, clasificacion: c.clasificacion, titulo: c.titulo,
      texto_origen: c.texto_origen, severidad: c.severidad, repo: c.repo, reporte_id: c.reporte_id ?? null,
      modulo: c.modulo ?? null, estado: estadoInicial(c.clasificacion),
    }));
    const { data: ins, error } = await svc.from("agente_ingeniero_tareas")
      .upsert(filas, { onConflict: "origen,origen_ref", ignoreDuplicates: true }).select("id, estado");
    if (error) {
      console.error("agente-ingeniero-cola: insert", error);
      return json({ error: "No se pudo guardar la cola." }, 500);
    }
    creadas = ins?.length ?? 0;
    propuestas = (ins ?? []).filter((f) => f.estado === "propuesta").length;
  }

  const { data: agente } = await svc.from("agentes").select("id").eq("clave", "ingeniero").maybeSingle();
  if (agente?.id) {
    await svc.from("agente_eventos").insert({
      agente_id: agente.id, tipo: modo === "barrido" ? "barrido" : "cola", estado: "observando",
      resumen: `${modo}: ${creadas} tarea(s) nueva(s) (${propuestas} propuesta(s)), ${candidatos.length - nuevos.length} ya conocida(s)`,
      evidencia_json: { modo, creadas, propuestas, candidatos: candidatos.length },
    });
  }

  return json({ ok: true, modo, creadas, propuestas, candidatos: candidatos.length });
});
