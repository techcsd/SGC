// BK4 — Informe DIARIO de incentivo (8am RD). Informativo, aparte del semanal:
// NO lleva PDF, NO escribe en incentivo_envio ni versiona, NO marca "cumplió".
// Mide la ACTIVIDAD del día (eventos crudos ponderados). Destinatarios por su
// propio parámetro (incentivo_diario_roles). Invocado por sgc.incentivo_cron_diario().
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-sync-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
}
const RENGLONES = [
  { key: "reporte_semanal", label: "Reporte" },
  { key: "inspeccion", label: "Inspección" },
  { key: "echada", label: "Echada" },
  { key: "ruta", label: "Ruta" },
  { key: "conduce", label: "Conduce" },
];
type Renglon = { propio?: number; ayudante?: number; puntos?: number };
interface Fila { nombre: string; puntaje: number; conteos: Record<string, Renglon>; }

function fmtDate(d: string | null): string {
  if (!d) return "";
  const [y, m, dd] = d.split("-");
  return `${dd}/${m}/${y}`;
}
function celda(f: Fila, key: string): string {
  const r = f.conteos?.[key];
  if (!r) return "·";
  const total = (r.propio ?? 0) + (r.ayudante ?? 0);
  return total > 0 ? String(total) : "·";
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { db: { schema: "sgc" } },
  );
  try {
    const secret = req.headers.get("x-sync-secret");
    const expected = Deno.env.get("INFRA_SYNC_SECRET");
    if (!expected || secret !== expected) return json({ error: "No autorizado." }, 401);

    const body = await req.json().catch(() => ({}));
    const fecha: string | null = body.fecha ?? null;
    if (!fecha) return json({ error: "Falta fecha." }, 400);

    const { data: rows, error } = await supabase.rpc("incentivo_dia_listado", { p_fecha: fecha });
    if (error) throw new Error(error.message);
    const filas: Fila[] = ((rows ?? []) as any[]).map((r) => ({
      nombre: r.nombre ?? "—",
      puntaje: Number(r.puntaje ?? 0),
      conteos: (r.conteos ?? {}) as Record<string, Renglon>,
    }));

    const { data: dest } = await supabase.rpc("destinatarios_informe_diario");
    const to = ((dest ?? []) as { email: string }[]).map((u) => u.email).filter(Boolean);

    const { data: resendApiKey } = await supabase.rpc("get_resend_api_key");
    const fromEmail = Deno.env.get("NOTIFICATIONS_FROM_EMAIL") ?? "notificaciones@resend.dev";
    const appUrl = Deno.env.get("APP_URL") ?? "https://sgcconstructorasd.com";

    let ok = true, errMsg: string | null = null;
    if (resendApiKey && to.length) {
      const td = "padding:6px 10px;border-bottom:1px solid #eee;";
      const th = "padding:6px 10px;border-bottom:2px solid #ddd;color:#555;";
      const colHead = RENGLONES.map((r) => `<th style="${th}text-align:center;">${esc(r.label)}</th>`).join("");
      const rowsHtml = filas.map((f) => {
        const celdas = RENGLONES.map((r) => `<td style="${td}text-align:center;">${celda(f, r.key)}</td>`).join("");
        return `<tr><td style="${td}font-weight:600;">${esc(f.nombre)}</td>${celdas}` +
          `<td style="${td}text-align:center;font-weight:700;">${f.puntaje}</td></tr>`;
      }).join("");
      const html =
        `<div style="font-family:Arial,sans-serif;color:#222;">` +
        `<h2 style="color:#ff5f00;margin:0 0 4px;">Actividad diaria — Choferes</h2>` +
        `<p style="color:#666;margin:0 0 16px;">${esc(fmtDate(fecha))} · ${filas.length} con actividad · informe informativo (no es el de pago)</p>` +
        `<div style="overflow-x:auto;"><table style="border-collapse:collapse;width:100%;font-size:13px;">` +
        `<thead><tr style="text-align:left;"><th style="${th}">Chofer</th>${colHead}<th style="${th}text-align:center;">Puntos</th></tr></thead>` +
        `<tbody>${rowsHtml || `<tr><td colspan="${RENGLONES.length + 2}" style="padding:10px;color:#888;">Sin actividad de choferes este día.</td></tr>`}</tbody></table></div>` +
        `<p style="color:#888;font-size:12px;margin:10px 0 0;">Cuenta la actividad del día (reportes, inspecciones, echadas con foto, rutas y conduces). El puntaje semanal de pago se calcula aparte, los lunes.</p>` +
        `<p style="margin:18px 0;"><a href="${appUrl}/incentivos" style="background:#ff5f00;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600;">Ver en SGC</a></p></div>`;
      const texto = [
        `Actividad diaria — Choferes`,
        `${fmtDate(fecha)} · ${filas.length} con actividad (informe informativo, no de pago)`,
        ``,
        ...filas.map((f) => `- ${f.nombre}: ` +
          RENGLONES.map((r) => `${r.label} ${celda(f, r.key)}`).join(", ") + ` · Puntos ${f.puntaje}`),
        ``,
        `Ver: ${appUrl}/incentivos`,
      ].join("\n");

      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${resendApiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: fromEmail, to, subject: `Actividad diaria de choferes — ${fmtDate(fecha)}`, html, text: texto }),
      });
      if (!res.ok) { ok = false; errMsg = await res.text(); }
    } else {
      ok = false;
      errMsg = !resendApiKey ? "sin Resend key" : "sin destinatarios";
    }
    return json({ sent: ok, to, error: errMsg });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Error desconocido." }, 500);
  }
});
