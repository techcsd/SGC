import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { envRequerido } from "../_shared/env.ts";

// ============================================================================
// F5 (ronda DF) — Agente Cronista (Nivel 1). Lo invoca pg_cron una vez al día,
// 6:30pm hora RD (22:30 UTC). SOLO genera y guarda el informe — nunca lo envía
// solo; "Enviar a Eduardo" es un clic explícito en Tecnología › Agentes
// (sgc.agente_informe_enviar), nunca automático.
//
// Cubre SGC (hallazgos/acciones/aprobaciones del día) y, en la medida de lo
// que existe, CSD App (sgc.app_error_reports + sgc.app_versiones). 100%
// determinista — sin llamadas a Anthropic, el "lenguaje sin jerga" sale de
// texto armado aquí mismo, no de un modelo (cero costo de IA en este agente).
// ============================================================================

const SUPABASE_URL = envRequerido("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function hoyRD(): string {
  // America/Santo_Domingo = UTC-4 todo el año (sin horario de verano).
  const ahoraUtc = new Date();
  const rd = new Date(ahoraUtc.getTime() - 4 * 3600 * 1000);
  return rd.toISOString().slice(0, 10);
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);

  const secret = req.headers.get("x-sync-secret");
  if (!secret || secret !== Deno.env.get("INFRA_SYNC_SECRET")) return json({ error: "No autorizado." }, 401);

  const svc = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { db: { schema: "sgc" } });
  const fecha = hoyRD();
  const desde = `${fecha}T00:00:00-04:00`;
  const hasta = `${fecha}T23:59:59-04:00`;

  const [{ data: hallazgos }, { data: acciones }, { data: aprobaciones }, { data: erroresApp }] = await Promise.all([
    svc.from("agente_hallazgos").select("severidad, titulo, origen, agente_id, agentes(nombre)").gte("creado_en", desde).lte("creado_en", hasta),
    svc.from("agente_acciones").select("que_hizo, resultado, reversible, agente_id, agentes(nombre)").gte("creado_en", desde).lte("creado_en", hasta),
    svc.from("agente_aprobaciones").select("propuesta, estado, pr_url").gte("creado_en", desde).lte("creado_en", hasta),
    svc.from("app_error_reports").select("error_type, message, platform").gte("created_at", desde).lte("created_at", hasta),
  ]);

  const lineas: string[] = [];
  lineas.push(`# Informe diario de Tecnología — ${fecha}`);
  lineas.push("");
  lineas.push("## SGC");
  lineas.push("");
  lineas.push(`**Lo que se encontró hoy:** ${hallazgos?.length ?? 0} hallazgo(s).`);
  for (const h of hallazgos ?? []) {
    const nombreAgente = (h as { agentes?: { nombre?: string } }).agentes?.nombre ?? "Agente";
    lineas.push(`- [${h.severidad}] ${h.titulo} (detectado por ${nombreAgente})`);
  }
  lineas.push("");
  lineas.push(`**Lo que arreglaron solos:** ${acciones?.length ?? 0} acción(es).`);
  for (const a of acciones ?? []) {
    const nombreAgente = (a as { agentes?: { nombre?: string } }).agentes?.nombre ?? "Agente";
    lineas.push(`- ${nombreAgente}: ${a.que_hizo}${a.reversible ? " (se puede deshacer)" : ""}`);
  }
  lineas.push("");
  lineas.push(`**Esperando tu OK:** ${aprobaciones?.filter((a) => a.estado === "pendiente").length ?? 0} propuesta(s) de código.`);
  for (const p of (aprobaciones ?? []).filter((a) => a.estado === "pendiente")) {
    lineas.push(`- ${p.propuesta}${p.pr_url ? ` — ${p.pr_url}` : " (sin PR todavía)"}`);
  }
  lineas.push("");
  lineas.push("## CSD App (móvil)");
  lineas.push("");
  if (erroresApp && erroresApp.length > 0) {
    lineas.push(`Hoy llegaron ${erroresApp.length} reporte(s) de error desde la app.`);
    const porTipo = new Map<string, number>();
    for (const e of erroresApp) porTipo.set(e.error_type, (porTipo.get(e.error_type) ?? 0) + 1);
    for (const [tipo, n] of porTipo) lineas.push(`- ${tipo}: ${n}`);
  } else {
    lineas.push("Sin reportes de error nuevos desde la app hoy.");
  }

  const contenidoMd = lineas.join("\n");

  const { data: fila, error } = await svc
    .from("agente_informes_diarios")
    .upsert({ fecha, contenido_md: contenidoMd }, { onConflict: "fecha" })
    .select("id")
    .single();

  if (error) {
    console.error("agente-cronista: no se pudo guardar el informe", error);
    return json({ error: "No se pudo guardar el informe." }, 500);
  }

  return json({ ok: true, informe_id: fila?.id, fecha });
});
