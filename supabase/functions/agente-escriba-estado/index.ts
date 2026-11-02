import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { envRequerido } from "../_shared/env.ts";
import { slugDe } from "../agente-escriba-solicitar/saneo.ts";

// ============================================================================
// DF2/F4 — agente-escriba-estado. Refleja en sgc.agente_aprobaciones el estado
// real de los PRs abiertos por el Escriba (rama/pr_url/pruebas_resultado).
//
// Decisión de diseño: POLLING por cron, no webhook de GitHub→Supabase. Este
// repo no tiene infraestructura de webhook receptor configurada (verificado:
// no hay endpoint que valide la firma HMAC de GitHub ni un secret para eso),
// y montarla solo para esto es más superficie nueva (un secret de webhook más
// que Xaviel tendría que configurar en GitHub) que un cron cada 10 min que
// reusa el MISMO token (AGENTE_ESCRIBA_GITHUB_TOKEN) que ya hace falta para
// disparar al Escriba en agente-escriba-solicitar.
//
// IMPORTANTE: este cron NUNCA cambia `estado` (pendiente|aprobada|ajuste|
// descartada) — esa decisión es humana (F5, panel de aprobaciones). Solo
// actualiza datos de hecho: pr_url y pruebas_resultado (si el PR tiene checks
// y si están en verde).
// ============================================================================

const SUPABASE_URL = envRequerido("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GITHUB_REPO = Deno.env.get("AGENTE_ESCRIBA_GITHUB_REPO") ?? "techcsd/SGC";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);

  const secret = req.headers.get("x-sync-secret");
  if (!secret || secret !== Deno.env.get("INFRA_SYNC_SECRET")) return json({ error: "No autorizado." }, 401);

  const ghToken = Deno.env.get("AGENTE_ESCRIBA_GITHUB_TOKEN");
  if (!ghToken) {
    // Sin token no hay nada que consultar — no es un error, el Escriba entero
    // está "pendiente de configuración" (ver agente-escriba-solicitar).
    return json({ ok: true, omitido: "github_no_configurado" });
  }

  const svc = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { db: { schema: "sgc" } });

  const { data: pendientes } = await svc
    .from("agente_aprobaciones")
    .select("id, pr_url")
    .in("estado", ["pendiente", "ajuste"])
    .is("pr_url", null);

  if (!pendientes?.length) return json({ ok: true, revisados: 0 });

  const resp = await fetch(
    `https://api.github.com/repos/${GITHUB_REPO}/pulls?state=open&head=${GITHUB_REPO.split("/")[0]}:feature/agente-`,
    { headers: { Authorization: `Bearer ${ghToken}`, Accept: "application/vnd.github+json" } },
  );
  if (!resp.ok) return json({ ok: false, error: "github_no_disponible" }, 502);
  const prs: Array<{ html_url: string; head: { ref: string }; number: number }> = await resp.json();

  // Empareja por slug determinista: el workflow nombra la rama
  // `feature/agente-<slug>` donde <slug> son los primeros 12 caracteres
  // alfanuméricos del propio `aprobacion_id` (ver agente-escriba.yml) — así
  // no hay que adivinar cuál PR corresponde a cuál fila.
  const porSlug = new Map(pendientes.map((p) => [slugDe(p.id), p]));

  let actualizados = 0;
  for (const pr of prs) {
    if (!pr.head.ref.startsWith("feature/agente-")) continue;
    const slug = pr.head.ref.replace("feature/agente-", "");
    const candidato = porSlug.get(slug);
    if (!candidato) continue; // rama de otro origen o ya resuelta — no se toca

    const checksResp = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/commits/${pr.head.ref}/check-runs`,
      { headers: { Authorization: `Bearer ${ghToken}`, Accept: "application/vnd.github+json" } },
    ).catch(() => null);
    const checks = checksResp?.ok ? await checksResp.json() : null;

    await svc
      .from("agente_aprobaciones")
      .update({
        rama: pr.head.ref,
        pr_url: pr.html_url,
        pruebas_resultado: checks
          ? { total: checks.total_count, conclusiones: checks.check_runs?.map((c: { conclusion: string | null }) => c.conclusion) }
          : { nota: "sin checks reportados aún" },
      })
      .eq("id", candidato.id);
    actualizados++;
  }

  return json({ ok: true, revisados: prs.length, actualizados });
});
