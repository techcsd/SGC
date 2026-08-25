import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { PDFDocument, StandardFonts, rgb } from "npm:pdf-lib@1.17.1";

// AT2 — Informe semanal del INCENTIVO por chofer: envía por email (Resend, PDF
// adjunto + tabla legible en el cuerpo) a los roles con el módulo `incentivos`
// (Logística y Transportación, Gerencia, Admin). Llamada SERVER-TO-SERVER desde
// el RPC sgc.incentivo_enviar_semana (cron de los lunes 10:00 AM RD) vía pg_net
// con el shared-secret `x-sync-secret`. Desplegar con verify_jwt=false.
//
// Este correo DECIDE UN PAGO: registra el envío en sgc.incentivo_envio (ok/error)
// para poder reenviar a mano si falla — nunca se pierde en silencio.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-sync-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(binary);
}

function fmtDate(s: string | null): string {
  if (!s) return "";
  const [y, m, d] = s.split("-");
  return d && m && y ? `${d}/${m}/${y}` : s;
}

interface Renglon { propio: number; ayudante: number; puntos: number }
interface Fila {
  nombre: string;
  puntaje: number;
  minimo: number;
  cumplio: boolean;
  conteos: Record<string, Renglon>;
  warns: number;
  decision: string | null;
}

// AX5 — mismas columnas y orden que el módulo "Desempeño de choferes".
const RENGLONES: { key: string; label: string }[] = [
  { key: "reporte_semanal", label: "Reporte semanal" },
  { key: "inspeccion", label: "Inspección de vehículo" },
  { key: "echada", label: "Registro de combustible" },
  { key: "ruta", label: "Rutas completadas" },
  { key: "conduce", label: "Conduces confirmados" },
];
function celda(f: Fila, key: string): number {
  const r = f.conteos?.[key];
  return r ? Number(r.propio ?? 0) + Number(r.ayudante ?? 0) : 0;
}

async function buildPdf(anio: number, semana: number, inicio: string, fin: string, filas: Fila[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  let page = doc.addPage([595, 842]);
  const margin = 48;
  let y = 800;

  const primary = rgb(1, 0.37, 0);      // --primary #ff5f00
  const dark = rgb(0.12, 0.15, 0.18);
  const green = rgb(0.09, 0.6, 0.31);
  const red = rgb(0.86, 0.15, 0.15);

  page.drawText("Incentivo semanal — Choferes", { x: margin, y, size: 18, font: bold, color: primary });
  y -= 24;
  page.drawText(`Semana ${semana} / ${anio}  ·  ${fmtDate(inicio)} – ${fmtDate(fin)}`, { x: margin, y, size: 11, font, color: rgb(0.4, 0.45, 0.5) });
  y -= 28;

  // Cabecera de tabla
  const colX = { nombre: margin, puntaje: 320, minimo: 400, estado: 470 };
  page.drawText("Chofer", { x: colX.nombre, y, size: 10, font: bold, color: dark });
  page.drawText("Puntaje", { x: colX.puntaje, y, size: 10, font: bold, color: dark });
  page.drawText("Mínimo", { x: colX.minimo, y, size: 10, font: bold, color: dark });
  page.drawText("Estado", { x: colX.estado, y, size: 10, font: bold, color: dark });
  y -= 6;
  page.drawLine({ start: { x: margin, y }, end: { x: 547, y }, thickness: 0.8, color: rgb(0.8, 0.8, 0.8) });
  y -= 16;

  for (const f of filas) {
    if (y < margin + 30) { page = doc.addPage([595, 842]); y = 800; }
    page.drawText(f.nombre.slice(0, 46), { x: colX.nombre, y, size: 10, font, color: dark });
    page.drawText(String(f.puntaje), { x: colX.puntaje, y, size: 10, font, color: dark });
    page.drawText(String(f.minimo), { x: colX.minimo, y, size: 10, font, color: dark });
    page.drawText(f.cumplio ? "Cumplió" : "Rendimiento bajo", { x: colX.estado, y, size: 10, font: bold, color: f.cumplio ? green : red });
    y -= 18;
  }

  y -= 10;
  const cumplieron = filas.filter((f) => f.cumplio).length;
  page.drawText(`Cumplieron: ${cumplieron} de ${filas.length}`, { x: margin, y, size: 10, font: bold, color: dark });

  return await doc.save();
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { db: { schema: "sgc" } },
  );
  let anio = 0, semana = 0;
  try {
    const secret = req.headers.get("x-sync-secret");
    const expected = Deno.env.get("INFRA_SYNC_SECRET");
    if (!expected || secret !== expected) return json({ error: "No autorizado." }, 401);

    const body = await req.json();
    anio = Number(body.anio); semana = Number(body.semana);
    if (!anio || !semana) return json({ error: "Falta anio/semana." }, 400);

    // AX5 — misma fuente que el módulo "Desempeño de choferes" (RPC detallado,
    // solo choferes, sin datos de prueba en el correo real).
    const { data: rows, error } = await supabase
      .rpc("incentivo_matriz_email", { p_anio: anio, p_semana: semana });
    if (error) throw new Error(error.message);

    const filas: Fila[] = ((rows ?? []) as any[]).map((r) => ({
      nombre: r.nombre ?? "—",
      puntaje: Number(r.puntaje ?? 0),
      minimo: Number(r.minimo ?? 0),
      cumplio: !!r.cumplio,
      conteos: (r.conteos ?? {}) as Record<string, Renglon>,
      warns: Array.isArray(r.flags) ? r.flags.length : 0,
      decision: r.decision ?? null,
    }));

    // inicio/fin de la semana para el encabezado.
    const { data: sem } = await supabase
      .from("incentivo_semana").select("inicio, fin")
      .eq("anio", anio).eq("semana", semana).limit(1).maybeSingle();
    const inicio = (sem as any)?.inicio ?? null;
    const fin = (sem as any)?.fin ?? null;

    const pdfBytes = await buildPdf(anio, semana, inicio, fin, filas);

    // AV7 — Destinatarios por ROL ELEVADO (parametrizable: incentivo_informe_roles),
    // nunca por correo quemado ni por "módulo admin". El informe compara choferes con
    // montos (sensible): solo roles elevados + admin.
    const { data: dest } = await supabase.rpc("destinatarios_informe_incentivo");
    const to = ((dest ?? []) as { email: string }[]).map((u) => u.email).filter(Boolean);

    const { data: resendApiKey } = await supabase.rpc("get_resend_api_key");
    const fromEmail = Deno.env.get("NOTIFICATIONS_FROM_EMAIL") ?? "notificaciones@resend.dev";

    let ok = true, errMsg: string | null = null;
    if (resendApiKey && to.length) {
      const appUrl = Deno.env.get("APP_URL") ?? "https://sgcconstructorasd.com";
      const cumplieron = filas.filter((f) => f.cumplio).length;
      const td = "padding:6px 10px;border-bottom:1px solid #eee;";
      const th = "padding:6px 10px;border-bottom:2px solid #ddd;color:#555;";

      // AX5 — matriz detallada idéntica al módulo: fila por chofer, celda por
      // renglón (cantidad hecha), Total x/mínimo y Estado con ⚠N (incidencias).
      const rowsHtml = filas.map((f) => {
        const badge = f.cumplio
          ? '<span style="background:#e7f6ec;color:#16a34a;padding:2px 8px;border-radius:10px;font-weight:600;">Cumplió</span>'
          : '<span style="background:#fdeaea;color:#dc2626;padding:2px 8px;border-radius:10px;font-weight:600;">Rendimiento bajo</span>';
        const warn = f.warns > 0
          ? ` <span title="Incidencias por revisar" style="background:#fef3c7;color:#b45309;padding:1px 7px;border-radius:10px;font-weight:700;font-size:12px;">⚠${f.warns}</span>`
          : "";
        const celdas = RENGLONES.map((r) =>
          `<td style="${td}text-align:center;">${celda(f, r.key)}</td>`).join("");
        return `<tr><td style="${td}font-weight:600;">${esc(f.nombre)}</td>${celdas}` +
          `<td style="${td}text-align:center;font-weight:700;">${f.puntaje} / ${f.minimo}</td>` +
          `<td style="${td}white-space:nowrap;">${badge}${warn}</td></tr>`;
      }).join("");
      const colHead = RENGLONES.map((r) =>
        `<th style="${th}text-align:center;">${esc(r.label)}</th>`).join("");
      const html =
        `<div style="font-family:Arial,sans-serif;color:#222;">` +
        `<h2 style="color:#ff5f00;margin:0 0 4px;">Incentivo semanal — Choferes</h2>` +
        `<p style="color:#666;margin:0 0 16px;">Semana ${semana} / ${anio} · ${esc(fmtDate(inicio))} – ${esc(fmtDate(fin))} · ${cumplieron}/${filas.length} cumplieron</p>` +
        `<div style="overflow-x:auto;"><table style="border-collapse:collapse;width:100%;font-size:13px;">` +
        `<thead><tr style="text-align:left;">` +
        `<th style="${th}">Chofer</th>${colHead}` +
        `<th style="${th}text-align:center;">Total</th><th style="${th}">Estado</th></tr></thead>` +
        `<tbody>${rowsHtml || `<tr><td colspan="${RENGLONES.length + 3}" style="padding:10px;color:#888;">Sin choferes con actividad esta semana.</td></tr>`}</tbody></table></div>` +
        `<p style="color:#888;font-size:12px;margin:10px 0 0;">⚠N = incidencias por revisar (rutas sin métrica / echadas duplicadas). El Total es puntos vs. el mínimo semanal.</p>` +
        `<p style="margin:18px 0;"><a href="${appUrl}/incentivos?anio=${anio}&semana=${semana}" ` +
        `style="background:#ff5f00;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600;">Ver en SGC / aprobar</a></p>` +
        `<p style="color:#888;font-size:12px;">El informe no paga solo: aprobar o declinar el incentivo es una decisión que registras en el sistema.</p></div>`;

      // Fallback de texto plano (clientes sin HTML).
      const texto = [
        `Incentivo semanal — Choferes`,
        `Semana ${semana}/${anio} · ${fmtDate(inicio)} – ${fmtDate(fin)} · ${cumplieron}/${filas.length} cumplieron`,
        ``,
        ...filas.map((f) =>
          `- ${f.nombre}: ` +
          RENGLONES.map((r) => `${r.label.split(" ")[0]} ${celda(f, r.key)}`).join(", ") +
          ` · Total ${f.puntaje}/${f.minimo} · ${f.cumplio ? "Cumplió" : "Bajo"}${f.warns ? ` (⚠${f.warns})` : ""}`),
        ``,
        `Ver/aprobar: ${appUrl}/incentivos?anio=${anio}&semana=${semana}`,
      ].join("\n");

      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${resendApiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: fromEmail, to,
          subject: `Incentivo semanal de choferes — Semana ${semana}/${anio}`,
          html, text: texto,
          attachments: [{ filename: `incentivo-semana-${anio}-${semana}.pdf`, content: toBase64(pdfBytes) }],
        }),
      });
      if (!res.ok) { ok = false; errMsg = await res.text(); }
    } else {
      ok = false;
      errMsg = !resendApiKey ? "sin Resend key" : "sin destinatarios";
    }

    // Registrar el envío (idempotente por (anio,semana)).
    await supabase.from("incentivo_envio").upsert(
      { anio, semana, destinatarios: to, ok, error: errMsg, enviado_at: new Date().toISOString() },
      { onConflict: "anio,semana" },
    );

    return json({ sent: ok, to, error: errMsg });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error desconocido.";
    try {
      await supabase.from("incentivo_envio").upsert(
        { anio, semana, ok: false, error: msg, enviado_at: new Date().toISOString() },
        { onConflict: "anio,semana" },
      );
    } catch (_) { /* noop */ }
    return json({ error: msg }, 500);
  }
});
