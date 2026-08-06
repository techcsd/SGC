import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { PDFDocument, StandardFonts, rgb } from "npm:pdf-lib@1.17.1";

// AG16 · FASE 5 — Genera el PDF del informe semanal de obra y lo envía por email
// a Gerencia (Resend, con el PDF adjunto). Llamada SERVER-TO-SERVER desde el RPC
// sgc.enviar_informe_semanal vía pg_net con el shared-secret `x-sync-secret`
// (mismo patrón que notificar-soporte / send-push). Debe desplegarse con
// verify_jwt=false. La Resend API key vive en Vault (sgc.get_resend_api_key).
//
// Best-effort: si falta config, no-opea en vez de fallar — un email perdido no
// debe romper el envío del informe (que ya quedó marcado 'enviado' en la BD).

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

function fmtDate(s: string | null): string {
  if (!s) return "";
  const [y, m, d] = s.split("-");
  return d && m && y ? `${d}/${m}/${y}` : s;
}

// Base64 chunk-safe (evita reventar el stack con PDFs multipágina).
function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function buildPdf(informe: any, proyectoNombre: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  let page = doc.addPage([595, 842]); // A4
  const margin = 48;
  let y = 800;
  const width = 595 - margin * 2;

  const primary = rgb(0.12, 0.31, 0.47);
  const dark = rgb(0.12, 0.15, 0.18);

  const line = (text: string, opts: { size?: number; f?: any; color?: any; gap?: number } = {}) => {
    const size = opts.size ?? 10;
    const f = opts.f ?? font;
    if (y < margin + 40) { page = doc.addPage([595, 842]); y = 800; }
    // wrap
    const words = (text ?? "").split(/\s+/);
    let cur = "";
    for (const w of words) {
      const test = cur ? cur + " " + w : w;
      if (f.widthOfTextAtSize(test, size) > width) {
        page.drawText(cur, { x: margin, y, size, font: f, color: opts.color ?? dark });
        y -= size + 4;
        cur = w;
        if (y < margin + 40) { page = doc.addPage([595, 842]); y = 800; }
      } else { cur = test; }
    }
    if (cur) { page.drawText(cur, { x: margin, y, size, font: f, color: opts.color ?? dark }); y -= size + (opts.gap ?? 6); }
    else y -= opts.gap ?? 6;
  };

  const sec = informe.secciones ?? {};
  const cm = informe.campos_manuales ?? {};

  line(`Informe semanal de obra`, { size: 18, f: bold, color: primary, gap: 4 });
  line(proyectoNombre, { size: 13, f: bold, color: dark, gap: 4 });
  line(`Período: ${fmtDate(informe.periodo_inicio)} – ${fmtDate(informe.periodo_fin)}`, { size: 10, color: rgb(0.4, 0.45, 0.5), gap: 12 });

  line(`Resumen de avance`, { size: 12, f: bold, color: primary });
  line(`Avance real: ${sec.avance_real_pct ?? 0}%   ·   Avance planificado: ${sec.avance_plan_pct ?? 0}%`);
  line(`NC abiertas: ${sec.nc_abiertas ?? 0}   ·   NC cerradas en el período: ${sec.nc_cerradas ?? 0}`);
  line(`Horas-hombre: ${Math.round(sec.horas_hombre ?? 0)}   ·   Pedidos pendientes: ${sec.pedidos_pendientes ?? 0}`);
  line(`Bitácoras: ${sec.bitacoras ?? 0}   ·   Pruebas de campo: ${sec.pruebas_campo ?? 0}   ·   Fotos: ${(sec.fotos ?? []).length}`, { gap: 12 });

  if ((sec.nc_criticas ?? []).length) {
    line(`No conformidades críticas abiertas`, { size: 12, f: bold, color: primary });
    for (const n of sec.nc_criticas) line(`• ${n.titulo} (${n.severidad})`);
    y -= 6;
  }
  if ((sec.incidentes ?? []).length) {
    line(`Incidentes del período`, { size: 12, f: bold, color: primary });
    for (const i of sec.incidentes) line(`• ${fmtDate(i.fecha)} — ${i.tipo} (${i.gravedad}): ${i.descripcion}`);
    y -= 6;
  }

  const manual: [string, string][] = [
    ["Resumen del gerente", cm.resumen], ["Problemas críticos", cm.problemas_criticos],
    ["Decisiones", cm.decisiones], ["Necesidades", cm.necesidades],
  ];
  for (const [t, v] of manual) {
    if (v && String(v).trim()) { line(t, { size: 12, f: bold, color: primary }); line(String(v), { gap: 10 }); }
  }

  return await doc.save();
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  try {
    const secret = req.headers.get("x-sync-secret");
    const expected = Deno.env.get("INFRA_SYNC_SECRET");
    if (!expected || secret !== expected) return json({ error: "No autorizado." }, 401);

    const { informe_id } = await req.json();
    if (!informe_id) return json({ error: "Falta informe_id." }, 400);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { db: { schema: "sgc" } },
    );

    const { data: informe, error } = await supabase
      .from("informes_semanales")
      .select("*, proyecto:proyectos(nombre)")
      .eq("id", informe_id)
      .single();
    if (error || !informe) return json({ error: error?.message ?? "Informe no encontrado." }, 404);

    const proyectoNombre = (informe as any).proyecto?.nombre ?? "Obra";
    const pdfBytes = await buildPdf(informe, proyectoNombre);

    // Guardar el PDF en el bucket `obra` y estampar pdf_path (best-effort).
    const pdfPath = `informes/${informe_id}.pdf`;
    try {
      await supabase.storage.from("obra").upload(pdfPath, pdfBytes, { contentType: "application/pdf", upsert: true });
      await supabase.from("informes_semanales").update({ pdf_path: pdfPath }).eq("id", informe_id);
    } catch (_) { /* no bloquea */ }

    // Email a Gerencia/Dirección con el PDF adjunto.
    const { data: resendApiKey } = await supabase.rpc("get_resend_api_key");
    if (!resendApiKey) return json({ pdf: pdfPath, email: "skipped: sin Resend key" });
    const fromEmail = Deno.env.get("NOTIFICATIONS_FROM_EMAIL") ?? "notificaciones@resend.dev";

    const { data: gerencia } = await supabase.rpc("usuarios_con_modulo", { p_modulo: "direccion" });
    let to = ((gerencia ?? []) as { email: string }[]).map((u) => u.email).filter(Boolean);
    if (to.length === 0) {
      const { data: admins } = await supabase.rpc("usuarios_con_modulo", { p_modulo: "admin" });
      to = ((admins ?? []) as { email: string }[]).map((u) => u.email).filter(Boolean);
    }
    if (to.length === 0) return json({ pdf: pdfPath, email: "skipped: sin destinatarios" });

    const base64 = toBase64(pdfBytes);
    const subject = `Informe semanal de obra — ${proyectoNombre} (${fmtDate((informe as any).periodo_inicio)}–${fmtDate((informe as any).periodo_fin)})`;
    const html = `<p>Adjunto el informe semanal de obra de <strong>${proyectoNombre}</strong>.</p>` +
      `<p>Avance real: <strong>${(informe as any).secciones?.avance_real_pct ?? 0}%</strong>. Ingresa a SGC → Producción de Obra → Informes para el detalle.</p>`;

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendApiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: fromEmail, to, subject, html,
        attachments: [{ filename: `informe-obra-${informe_id}.pdf`, content: base64 }],
      }),
    });
    if (!res.ok) return json({ pdf: pdfPath, email: `error: ${await res.text()}` }, 502);
    return json({ sent: true, to, pdf: pdfPath });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Error desconocido." }, 500);
  }
});
