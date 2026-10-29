import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { ajustarCorreoResend } from "../_shared/entorno.ts";
import { corsHeaders as construirCors } from "../_shared/cors.ts";
import { envRequerido } from "../_shared/env.ts";
import { construirPdfPagos, type LineaPdf, type Any } from "./pdf.ts";

// ============================================================================
// DB4 (Ronda DB) — Genera el PDF de pagos con descargo firmado (hoja resumen +
// una hoja por persona con identificación, monto, texto del descargo y firma) y
// lo manda por Resend a `pagos_descargo_correos` + `pagos_descargo_correos_extra`.
// SERVER-TO-SERVER desde sgc.pagos_obra_enviar vía pg_net con `x-sync-secret`
// (patrón generar-informe-obra). verify_jwt=false. PDF al bucket `obra`
// (`pagos/…`; no existe un bucket `documentos` — adaptación reportada).
// Los MONTOS nunca pasan por IA ni por el conector (guard).
// ============================================================================

function fmtDate(s: string | null): string {
  if (!s) return "";
  const [y, m, d] = String(s).split("-");
  return d && m && y ? `${d}/${m}/${y}` : String(s);
}
function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(binary);
}

Deno.serve(async (req: Request) => {
  const corsHeaders = construirCors(req, { headersExtra: "x-sync-secret" });
  function json(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  try {
    const secret = req.headers.get("x-sync-secret");
    const expected = Deno.env.get("INFRA_SYNC_SECRET");
    if (!expected || secret !== expected) return json({ error: "No autorizado." }, 401);

    const { pago_id } = await req.json();
    if (!pago_id) return json({ error: "Falta pago_id." }, 400);

    const supabase = createClient(
      envRequerido("SUPABASE_URL"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { db: { schema: "sgc" } },
    );

    const { data: pago, error } = await supabase
      .from("pagos_obra")
      .select("*, proyecto:proyectos!proyecto_id(nombre)")
      .eq("id", pago_id)
      .single();
    if (error || !pago) return json({ error: error?.message ?? "Pago no encontrado." }, 404);

    const { data: lineas } = await supabase
      .from("pagos_obra_lineas")
      .select("*")
      .eq("pago_id", pago_id)
      .order("nombre_snapshot");

    const { data: plantilla } = await supabase
      .from("plantillas_documento")
      .select("contenido_html")
      .eq("nombre", "descargo_pago_semanal")
      .eq("activo", true)
      .maybeSingle();

    const { data: empresa } = await supabase.from("empresa").select("nombre").maybeSingle();

    // Bajar las firmas (solo líneas firmadas).
    const lineasPdf: LineaPdf[] = [];
    for (const l of (lineas ?? []) as Any[]) {
      let firmaPng: Uint8Array | null = null;
      if (l.estado === "firmado" && l.firma_path) {
        try {
          const { data: blob } = await supabase.storage.from("obra").download(l.firma_path);
          if (blob) firmaPng = new Uint8Array(await blob.arrayBuffer());
        } catch { /* sin firma embebida, la hoja no se genera para esta línea */ }
      }
      lineasPdf.push({
        nombre: l.nombre_snapshot,
        documento: l.documento_numero_snapshot ?? "",
        cargo: l.cargo_snapshot ?? "",
        monto: l.monto,
        concepto: l.concepto ?? "",
        firmaPng,
      });
    }

    const desde = fmtDate(pago.semana_desde);
    const hasta = fmtDate(pago.semana_hasta);
    const obra = (pago as Any).proyecto?.nombre ?? "Obra";
    const pdfBytes = await construirPdfPagos({
      obra, desde, hasta,
      empresa: (empresa as Any)?.nombre ?? "Constructora SD",
      textoDescargo: (plantilla as Any)?.contenido_html ?? "Recibí conforme el pago de la semana.",
      lineas: lineasPdf,
      esComplemento: !!pago.complemento_de,
    });

    const pdfPath = `pagos/${pago.proyecto_id}/${pago_id}.pdf`;
    try {
      await supabase.storage.from("obra").upload(pdfPath, pdfBytes, { contentType: "application/pdf", upsert: true });
      await supabase.from("pagos_obra").update({ pdf_path: pdfPath }).eq("id", pago_id);
    } catch (_) { /* no bloquea el correo */ }

    // Destinatarios: parámetro + extras (CSV), dedupe.
    const { data: params } = await supabase
      .from("parametros").select("clave, valor")
      .in("clave", ["pagos_descargo_correos", "pagos_descargo_correos_extra"]);
    const csv = (clave: string, def = "") =>
      (((params ?? []) as Any[]).find((p) => p.clave === clave)?.valor ?? def) as string;
    const to = [...new Set(
      `${csv("pagos_descargo_correos", "depto.legal@constructorasd.com,eduardong@constructorasd.com")},${csv("pagos_descargo_correos_extra")}`
        .split(",").map((s) => s.trim().toLowerCase()).filter((s) => s.includes("@")),
    )];
    if (!to.length) return json({ pdf: pdfPath, email: "skipped: sin destinatarios" });

    const { data: resendApiKey } = await supabase.rpc("get_resend_api_key");
    if (!resendApiKey) return json({ pdf: pdfPath, email: "skipped: sin Resend key" });
    const fromEmail = Deno.env.get("NOTIFICATIONS_FROM_EMAIL") ?? "notificaciones@resend.dev";

    const firmadas = lineasPdf.filter((l) => l.firmaPng).length;
    const subject = `Pagos con descargo — ${obra} — Semana del ${desde} al ${hasta}${pago.complemento_de ? " (complemento)" : ""}`;
    const html =
      `<p>Adjunto el reporte de pagos con descargo firmado de <strong>${obra}</strong> (semana del ${desde} al ${hasta}).</p>` +
      `<p>Descargos firmados: <strong>${firmadas}</strong> de ${lineasPdf.length}. El detalle, persona por persona, va en el PDF.</p>`;

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendApiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(ajustarCorreoResend({
        from: fromEmail, to, subject, html,
        attachments: [{ filename: `pagos-descargo-${pago.semana_desde}.pdf`, content: toBase64(pdfBytes) }],
      })),
    });
    if (!res.ok) return json({ pdf: pdfPath, email: `error: ${await res.text()}` }, 502);

    await supabase.from("pagos_obra").update({ correos_enviados: to }).eq("id", pago_id);
    return json({ sent: true, to, pdf: pdfPath, firmadas });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Error desconocido." }, 500);
  }
});
