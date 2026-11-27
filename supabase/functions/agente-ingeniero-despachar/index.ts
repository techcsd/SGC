import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { envRequerido } from "../_shared/env.ts";
import {
  normalizarConfig,
  payloadDispatch,
  repoGithub,
  seleccionarDespachos,
  type EstadoDia,
  type TareaDespacho,
} from "../_shared/agente-ingeniero-lib.ts";

// ============================================================================
// EA3 -- agente-ingeniero-despachar. pg_cron (x-sync-secret). Elige tareas 'nueva'
// y dispara un repository_dispatch (event_type "agente-ingeniero") al repo correcto.
//   * client_payload lleva SOLO { tarea_id, repo } -- nunca texto de usuario.
//   * Respeta agentes_pausa_total, max_prod_por_dia y el presupuesto de IA del dia.
//   * Token: variable de entorno GITHUB_AGENTES_TOKEN (SOLO de esta edge; jamas en
//     la base, el front ni los logs). Sin token = no-op inerte, queda registrado.
//   * Repos: AGENTES_REPO_SGC (default techcsd/SGC), AGENTES_REPO_CSD_APP (default techcsd/csd-app).
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

  const svc = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { db: { schema: "sgc" } });
  const { data: agente } = await svc.from("agentes").select("id").eq("clave", "ingeniero").maybeSingle();
  const evento = async (tipo: string, estado: string, resumen: string, ev: Record<string, unknown> = {}) => {
    if (agente?.id) await svc.from("agente_eventos").insert({ agente_id: agente.id, tipo, estado, resumen, evidencia_json: ev });
  };

  const ghToken = Deno.env.get("GITHUB_AGENTES_TOKEN");
  if (!ghToken) {
    await evento("despacho_inerte", "inactivo", "Sin GITHUB_AGENTES_TOKEN: el despacho no hace nada (no-op).");
    return json({ ok: true, inerte: true, motivo: "sin_token" });
  }

  const { data: cfgRaw } = await svc.rpc("ing_config_leer");
  const cfg = normalizarConfig(cfgRaw);
  const { data: diaRaw } = await svc.rpc("ing_estado_dia");
  const dia: EstadoDia = {
    prod_hoy: Number(diaRaw?.prod_hoy ?? 0),
    costo_hoy_usd: Number(diaRaw?.costo_hoy_usd ?? 0),
  };

  const [{ data: nuevas }, { count: enVuelo }] = await Promise.all([
    svc.from("agente_ingeniero_tareas")
      .select("id, estado, severidad, repo, creada_en, despachada_en, despachos")
      .eq("estado", "nueva").order("creada_en", { ascending: true }).limit(50),
    svc.from("agente_ingeniero_tareas").select("id", { count: "exact", head: true })
      .in("estado", ["analizando", "en_codigo", "en_revision"]),
  ]);

  const { elegidas, freno } = seleccionarDespachos((nuevas ?? []) as TareaDespacho[], enVuelo ?? 0, cfg, dia, Date.now());
  if (freno) {
    await evento("despacho_frenado", "observando", `Despacho detenido: ${freno}`, { freno, ...dia });
    return json({ ok: true, despachadas: 0, freno });
  }

  const envRepos = { sgc: Deno.env.get("AGENTES_REPO_SGC") ?? undefined, csdApp: Deno.env.get("AGENTES_REPO_CSD_APP") ?? undefined };
  let despachadas = 0;
  const fallos: string[] = [];
  for (const t of elegidas) {
    const repo = repoGithub(t.repo, envRepos);
    let ok = false;
    try {
      const r = await fetch(`https://api.github.com/repos/${repo}/dispatches`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${ghToken}`, Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28", "Content-Type": "application/json", "User-Agent": "sgc-agente-ingeniero",
        },
        body: JSON.stringify(payloadDispatch(t, repo)),
      });
      ok = r.status === 204;
      if (!ok) fallos.push(`${t.id}: HTTP ${r.status}`);
    } catch (e) {
      fallos.push(`${t.id}: ${e instanceof Error ? e.message : "error de red"}`);
    }
    // Se cuenta el intento aunque falle, para no martillar GitHub (tope MAX_DESPACHOS_POR_TAREA).
    await svc.from("agente_ingeniero_tareas")
      .update({ despachada_en: new Date().toISOString(), despachos: t.despachos + 1 }).eq("id", t.id);
    if (ok) despachadas++;
  }

  await evento("despacho", fallos.length ? "error" : "observando",
    `Despachadas ${despachadas}/${elegidas.length}${fallos.length ? ` - fallos: ${fallos.length}` : ""}`,
    { despachadas, elegidas: elegidas.length, fallos });
  return json({ ok: true, despachadas, elegidas: elegidas.length, fallos: fallos.length });
});
