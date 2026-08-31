import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { PDFDocument, StandardFonts, rgb } from "npm:pdf-lib@1.17.1";

// BE1 — Resumen semanal de OPERACIONES: envía por email (Resend, HTML + PDF
// detallado) a los roles administrables (destinatarios_resumen_operaciones) el
// panorama de la semana. Llamada SERVER-TO-SERVER desde sgc.resumen_operaciones_
// enviar_semana (cron de los lunes 7:00 AM RD) vía pg_net con `x-sync-secret`.
// Desplegar con verify_jwt=false.
//
// AU1 — cada sección sale de una TOOL de Compa (misma RPC que el chat): los
// números del correo = los números de la pantalla. El correo COMPONE las secciones
// construidas 1 a 1 (BE1). PDF adjunto con el detalle (lección BB9).

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
function toBase64(bytes: Uint8Array): string {
  let binary = ""; const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(binary);
}
function fmtDate(s: string | null): string {
  if (!s) return "";
  const [y, m, d] = String(s).split("-");
  return d && m && y ? `${d}/${m}/${y}` : String(s);
}

// deno-lint-ignore no-explicit-any
type Any = any;

// ── PDF — cada sección es una tabla (título + columnas + filas). BB9: el PDF
// trae el DETALLE (la matriz completa, la lista de pendientes con su edad). ──
interface Seccion { titulo: string; cols: string[]; rows: string[][]; nota?: string }

async function buildPdf(anio: number, semana: number, ini: string, fin: string, secciones: Seccion[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const W = 842, H = 595, M = 40; // A4 apaisado
  const primary = rgb(1, 0.37, 0), dark = rgb(0.12, 0.15, 0.18), muted = rgb(0.4, 0.45, 0.5);
  let page = doc.addPage([W, H]);
  let y = H - M;
  const clip = (t: string, max: number) => (t.length > max ? t.slice(0, max - 1) + "…" : t);

  page.drawText("Resumen semanal de operaciones", { x: M, y, size: 16, font: bold, color: primary }); y -= 20;
  page.drawText(`Semana ${semana} / ${anio}  ·  ${fmtDate(ini)} – ${fmtDate(fin)}`, { x: M, y, size: 10, font, color: muted }); y -= 26;

  for (const sec of secciones) {
    if (y < M + 60) { page = doc.addPage([W, H]); y = H - M; }
    page.drawText(sec.titulo, { x: M, y, size: 12, font: bold, color: dark }); y -= 16;
    if (sec.nota) { page.drawText(clip(sec.nota, 150), { x: M, y, size: 8.5, font, color: muted }); y -= 13; }
    const colW = (W - 2 * M) / Math.max(1, sec.cols.length);
    const maxChars = Math.max(8, Math.floor(colW / 5.2));
    const header = () => {
      sec.cols.forEach((c, i) => page.drawText(clip(c, maxChars), { x: M + i * colW, y, size: 8.5, font: bold, color: dark }));
      y -= 13;
    };
    header();
    if (!sec.rows.length) { page.drawText("Sin datos esta semana.", { x: M, y, size: 8.5, font, color: muted }); y -= 12; }
    for (const row of sec.rows) {
      if (y < M + 20) { page = doc.addPage([W, H]); y = H - M; header(); }
      row.forEach((cell, i) => page.drawText(clip(cell ?? "", maxChars), { x: M + i * colW, y, size: 8, font, color: dark }));
      y -= 11;
    }
    y -= 16;
  }
  return await doc.save();
}

// ── Estilos inline para el HTML del correo ──────────────────────────────────
const TD = "padding:6px 10px;border-bottom:1px solid #eee;";
const TH = "padding:6px 10px;border-bottom:2px solid #ddd;color:#555;text-align:left;";
function tabla(cols: string[], rows: string[][], vacio = "Sin datos esta semana."): string {
  const head = cols.map((c) => `<th style="${TH}">${esc(c)}</th>`).join("");
  const body = rows.length
    ? rows.map((r) => `<tr>${r.map((c, i) => `<td style="${TD}${i > 0 ? "text-align:center;" : ""}">${esc(c)}</td>`).join("")}</tr>`).join("")
    : `<tr><td colspan="${cols.length}" style="padding:10px;color:#888;">${esc(vacio)}</td></tr>`;
  return `<div style="overflow-x:auto;"><table style="border-collapse:collapse;width:100%;font-size:13px;margin:6px 0 14px;">` +
    `<thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { db: { schema: "sgc" } },
  );
  let anio = 0, semana = 0;
  try {
    const secret = req.headers.get("x-sync-secret");
    const expected = Deno.env.get("INFRA_SYNC_SECRET");
    if (!expected || secret !== expected) return json({ error: "No autorizado." }, 401);

    const body = await req.json();
    anio = Number(body.anio); semana = Number(body.semana);
    if (!anio || !semana) return json({ error: "Falta anio/semana." }, 400);

    // ── Cada sección = una TOOL de Compa (misma RPC que el chat). AU1. ────────
    const p = { p_anio: anio, p_semana: semana };
    const [{ data: rango }, req1, est2, rut3, con4, inv5, flo6, bit7] = await Promise.all([
      supabase.rpc("semana_rango", p).single(),
      supabase.rpc("resumen_requisiciones_semana", p),
      supabase.rpc("resumen_estatus_requisiciones", p),
      supabase.rpc("resumen_rutas_semana", p),
      supabase.rpc("resumen_conduces_semana", p),
      supabase.rpc("resumen_inventario_semana", p),
      supabase.rpc("resumen_flota_carga_semana", p),
      supabase.rpc("resumen_bitacoras_semana", p),
    ]);
    const ini = (rango as Any)?.inicio ?? null;
    const fin = (rango as Any)?.fin ?? null;
    const r1: Any = req1.data ?? {};
    const r2: Any = est2.data ?? {};
    const r3: Any = rut3.data ?? {};
    const r4: Any = con4.data ?? {};
    const r5: Any = inv5.data ?? {};
    const r6: Any = flo6.data ?? {};
    const r7: Any = bit7.data ?? {};

    // ── Secciones (HTML + PDF). Crece 1 a 1 (reportes 3-7 se agregan aquí). ──
    const htmlSecs: string[] = [];
    const pdfSecs: Seccion[] = [];

    // Reporte 1 — Requisiciones por obra × ingeniero.
    {
      const matriz: Any[] = Array.isArray(r1.matriz) ? r1.matriz : [];
      const rows = matriz.map((m) => [String(m.obra), String(m.ingeniero), String(m.cantidad)]);
      htmlSecs.push(
        `<h3 style="color:#333;margin:18px 0 2px;">1 · Requisiciones por obra e ingeniero</h3>` +
        `<p style="color:#666;margin:0 0 6px;font-size:13px;">Total de la semana: <b>${Number(r1.total ?? 0)}</b></p>` +
        tabla(["Obra", "Ingeniero", "Requisiciones"], rows));
      pdfSecs.push({ titulo: "1 · Requisiciones por obra e ingeniero", cols: ["Obra", "Ingeniero", "Requisiciones"], rows,
        nota: `Total de la semana: ${Number(r1.total ?? 0)}` });
    }

    // Reporte 2 — Estatus (embudo + pendientes por atender con su edad).
    {
      const e = r2.embudo ?? {};
      const embudoRows = [
        ["Creadas", String(e.creadas ?? 0)],
        ["Pendientes", String(e.pendientes ?? 0)],
        ["Aprobadas (sin despachar)", String(e.aprobadas ?? 0)],
        ["Despachadas parcial", String(e.despachadas_parcial ?? 0)],
        ["Despachadas total", String(e.despachadas_total ?? 0)],
        ["Canceladas/rechazadas", String(e.canceladas ?? 0)],
      ];
      const pend: Any[] = Array.isArray(r2.pendientes_por_atender) ? r2.pendientes_por_atender : [];
      const pendRows = pend.map((p) => [String(p.codigo), String(p.obra), `${p.dias_esperando} día(s)`, String(p.fase)]);
      htmlSecs.push(
        `<h3 style="color:#333;margin:18px 0 2px;">2 · Estatus de las requisiciones</h3>` +
        tabla(["Estado", "Cantidad"], embudoRows) +
        `<p style="color:#666;margin:6px 0 4px;font-size:13px;"><b>Pendientes por atender</b> (más antiguas primero):</p>` +
        tabla(["Requisición", "Obra", "Esperando", "Fase"], pendRows, "Nada pendiente por atender esta semana. 🎉"));
      pdfSecs.push({ titulo: "2 · Estatus — embudo", cols: ["Estado", "Cantidad"], rows: embudoRows });
      pdfSecs.push({ titulo: "2 · Pendientes por atender (más antiguas primero)",
        cols: ["Requisición", "Obra", "Esperando", "Fase"], rows: pendRows });
    }

    // Reporte 3 — Rutas hechas (completadas + en revisión APARTE, BB8).
    {
      const porChofer: Any[] = Array.isArray(r3.por_chofer) ? r3.por_chofer : [];
      const rows = porChofer.map((c) => [String(c.chofer), String(c.completadas), String(c.en_revision)]);
      const resumen = `${Number(r3.completadas ?? 0)} completadas` +
        (Number(r3.en_revision ?? 0) > 0 ? ` · ${Number(r3.en_revision)} en revisión` : "");
      htmlSecs.push(
        `<h3 style="color:#333;margin:18px 0 2px;">3 · Rutas hechas</h3>` +
        `<p style="color:#666;margin:0 0 6px;font-size:13px;"><b>${esc(resumen)}</b>` +
        (Number(r3.en_revision ?? 0) > 0 ? ` <span style="color:#b45309;">(las "en revisión" son rutas completadas sin km/tiempo — cuarentena BB8, se cuentan aparte)</span>` : "") +
        `</p>` +
        tabla(["Chofer", "Completadas", "En revisión"], rows));
      pdfSecs.push({ titulo: "3 · Rutas hechas (por chofer)", cols: ["Chofer", "Completadas", "En revisión"], rows, nota: resumen });
    }

    // Reporte 4 — Conduces hechos por tipo y obra destino.
    {
      const porObra: Any[] = Array.isArray(r4.por_obra) ? r4.por_obra : [];
      const rows = porObra.map((o) => [String(o.obra), String(o.normal), String(o.externo)]);
      htmlSecs.push(
        `<h3 style="color:#333;margin:18px 0 2px;">4 · Conduces hechos</h3>` +
        `<p style="color:#666;margin:0 0 6px;font-size:13px;">Total <b>${Number(r4.total ?? 0)}</b> · normales ${Number(r4.total_normal ?? 0)} · externos ${Number(r4.total_externo ?? 0)}</p>` +
        tabla(["Obra destino", "Normales", "Externos"], rows));
      pdfSecs.push({ titulo: "4 · Conduces por obra destino", cols: ["Obra destino", "Normales", "Externos"], rows,
        nota: `Total ${Number(r4.total ?? 0)} (normales ${Number(r4.total_normal ?? 0)}, externos ${Number(r4.total_externo ?? 0)})` });
    }

    // Reporte 5 — Movimiento de inventario por almacén.
    {
      const porAlm: Any[] = Array.isArray(r5.por_almacen) ? r5.por_almacen : [];
      const rows = porAlm.map((a) => [String(a.almacen), String(a.entradas), String(a.salidas), String(a.ajustes)]);
      htmlSecs.push(
        `<h3 style="color:#333;margin:18px 0 2px;">5 · Movimiento de equipos y materiales</h3>` +
        `<p style="color:#666;margin:0 0 6px;font-size:13px;">Entradas ${Number(r5.total_entradas ?? 0)} · Salidas ${Number(r5.total_salidas ?? 0)} · Ajustes ${Number(r5.total_ajustes ?? 0)}</p>` +
        tabla(["Almacén", "Entradas", "Salidas", "Ajustes"], rows));
      pdfSecs.push({ titulo: "5 · Movimiento de inventario por almacén", cols: ["Almacén", "Entradas", "Salidas", "Ajustes"], rows });
    }

    // Reporte 6 — Km + combustible de vehículos de carga (solo echadas válidas AW3).
    {
      const porVeh: Any[] = Array.isArray(r6.por_vehiculo) ? r6.por_vehiculo : [];
      const rows = porVeh.map((v) => [String(v.placa), String(v.km), String(v.galones), String(v.costo)]);
      const depuracion = r6.km_en_depuracion
        ? ' <span style="color:#b45309;">(km en depuración: hay echadas sin odómetro registrado)</span>' : "";
      htmlSecs.push(
        `<h3 style="color:#333;margin:18px 0 2px;">6 · Km y combustible — vehículos de carga</h3>` +
        `<p style="color:#666;margin:0 0 6px;font-size:13px;">Galones ${Number(r6.total_galones ?? 0)} · Km ${Number(r6.total_km ?? 0)} · Costo ${Number(r6.total_costo ?? 0)}${depuracion}</p>` +
        tabla(["Vehículo", "Km", "Galones", "Costo"], rows));
      pdfSecs.push({ titulo: "6 · Km y combustible — vehículos de carga", cols: ["Vehículo", "Km", "Galones", "Costo"], rows,
        nota: r6.km_en_depuracion ? "Km en depuración: hay echadas sin odómetro registrado." : undefined });
    }

    // Reporte 7 — Bitácoras por obra vs días laborables.
    {
      const porObra: Any[] = Array.isArray(r7.por_obra) ? r7.por_obra : [];
      const rows = porObra.map((o) => [String(o.obra), `${o.dias_con_bitacora}/${o.dias_laborables}`]);
      htmlSecs.push(
        `<h3 style="color:#333;margin:18px 0 2px;">7 · Bitácoras por obra</h3>` +
        `<p style="color:#666;margin:0 0 6px;font-size:13px;">Total ${Number(r7.total_bitacoras ?? 0)} bitácoras · días laborables de la semana: ${Number(r7.dias_laborables ?? 6)}</p>` +
        tabla(["Obra", "Días con bitácora"], rows, "Sin obras activas."));
      pdfSecs.push({ titulo: "7 · Bitácoras por obra (días con bitácora / laborables)", cols: ["Obra", "Días con bitácora"], rows });
    }

    const pdfBytes = await buildPdf(anio, semana, ini, fin, pdfSecs);

    // Destinatarios (patrón "Quién recibe" AV7, administrable).
    const { data: dest } = await supabase.rpc("destinatarios_resumen_operaciones");
    const to = ((dest ?? []) as { email: string }[]).map((u) => u.email).filter(Boolean);
    const { data: resendApiKey } = await supabase.rpc("get_resend_api_key");
    const fromEmail = Deno.env.get("NOTIFICATIONS_FROM_EMAIL") ?? "notificaciones@resend.dev";
    const appUrl = Deno.env.get("APP_URL") ?? "https://sgcconstructorasd.com";

    let ok = true, errMsg: string | null = null;
    if (resendApiKey && to.length) {
      const html =
        `<div style="font-family:Arial,sans-serif;color:#222;max-width:820px;">` +
        `<h2 style="color:#ff5f00;margin:0 0 4px;">Resumen semanal de operaciones</h2>` +
        `<p style="color:#666;margin:0 0 8px;">Semana ${semana} / ${anio} · ${esc(fmtDate(ini))} – ${esc(fmtDate(fin))}</p>` +
        htmlSecs.join("") +
        `<p style="margin:18px 0;"><a href="${appUrl}" style="background:#ff5f00;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600;">Abrir SGC</a></p>` +
        `<p style="color:#888;font-size:12px;">El detalle completo va en el PDF adjunto. Puedes preguntarle a Compa cualquiera de estos números en el chat.</p></div>`;

      const texto = [
        `Resumen semanal de operaciones — Semana ${semana}/${anio} · ${fmtDate(ini)} – ${fmtDate(fin)}`,
        ``,
        `1) Requisiciones (total ${Number(r1.total ?? 0)}):`,
        ...((r1.por_obra ?? []) as Any[]).map((o) => `   - ${o.obra}: ${o.cantidad}`),
        ``,
        `2) Estatus: creadas ${r2.embudo?.creadas ?? 0} · pendientes ${r2.embudo?.pendientes ?? 0} · aprobadas ${r2.embudo?.aprobadas ?? 0} · desp. parcial ${r2.embudo?.despachadas_parcial ?? 0} · desp. total ${r2.embudo?.despachadas_total ?? 0} · canceladas ${r2.embudo?.canceladas ?? 0}`,
        ...(((r2.pendientes_por_atender ?? []) as Any[]).length
          ? ["   Pendientes por atender:", ...((r2.pendientes_por_atender ?? []) as Any[]).map((pp) => `   - ${pp.codigo} · ${pp.obra} · ${pp.dias_esperando} día(s)`)]
          : []),
        ``,
        `3) Rutas hechas: ${Number(r3.completadas ?? 0)} completadas${Number(r3.en_revision ?? 0) > 0 ? ` · ${Number(r3.en_revision)} en revisión (cuarentena)` : ""}`,
        `4) Conduces hechos: ${Number(r4.total ?? 0)} (normales ${Number(r4.total_normal ?? 0)}, externos ${Number(r4.total_externo ?? 0)})`,
        `5) Movimiento de inventario: entradas ${Number(r5.total_entradas ?? 0)} · salidas ${Number(r5.total_salidas ?? 0)} · ajustes ${Number(r5.total_ajustes ?? 0)}`,
        `6) Km/combustible (carga): ${Number(r6.total_galones ?? 0)} gal · ${Number(r6.total_km ?? 0)} km${r6.km_en_depuracion ? " (km en depuración)" : ""}`,
        `7) Bitácoras: ${Number(r7.total_bitacoras ?? 0)} en la semana (laborables ${Number(r7.dias_laborables ?? 6)})`,
      ].join("\n");

      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${resendApiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: fromEmail, to,
          subject: `Resumen semanal de operaciones — Semana ${semana}/${anio}`,
          html, text: texto,
          attachments: [{ filename: `resumen-operaciones-${anio}-${semana}.pdf`, content: toBase64(pdfBytes) }],
        }),
      });
      if (!res.ok) { ok = false; errMsg = await res.text(); }
    } else {
      ok = false;
      errMsg = !resendApiKey ? "sin Resend key" : "sin destinatarios";
    }

    await supabase.from("resumen_operaciones_envio").upsert(
      { anio, semana, destinatarios: to, ok, error: errMsg, enviado_at: new Date().toISOString() },
      { onConflict: "anio,semana" },
    );
    return json({ sent: ok, to, error: errMsg });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error desconocido.";
    try {
      await supabase.from("resumen_operaciones_envio").upsert(
        { anio, semana, ok: false, error: msg, enviado_at: new Date().toISOString() },
        { onConflict: "anio,semana" },
      );
    } catch (_) { /* noop */ }
    return json({ error: msg }, 500);
  }
});
