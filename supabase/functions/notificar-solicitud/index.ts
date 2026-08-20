import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { PDFDocument, StandardFonts, rgb } from "https://esm.sh/pdf-lib@1.17.1?target=deno";

// Email notifications for the solicitudes workflow. Called directly by the
// frontend right after a solicitud is created/approved/rejected — no DB
// webhook/pg_net involved.
//
// AS6 — On a material requisición 'creada' the email is enriched: a readable
// summary (obra, solicitante, urgencia, fecha/hora), an items table, a "Ver
// detalle" button that deep-links to the production web inbox
// (sgcconstructorasd.com/bitacora/solicitudes-material — login enforced by the
// app), and a one-page PDF attachment generated in-function with pdf-lib.
// Recipients are the requisición matrix (usuarios_destinatarios_requisicion),
// not a broadcast. PDF generation is best-effort: on failure the enriched HTML
// email still goes out.
//
// The Resend API key is stored in Supabase Vault (see
// sql/2026-07-02-vault-resend-key.sql) rather than a plain
// RESEND_API_KEY env var — fetched here via sgc.get_resend_api_key(),
// which is only executable by service_role, so the key is never exposed
// to the Angular frontend. If the key isn't set yet, this no-ops instead
// of failing — a missing notification should never block the real
// workflow.

// AS6 — On 'creada' the email carries a readable summary, an authenticated
// deep-link to the web requisición inbox, and a one-page PDF attachment.
// Production web base (hard rule: never localhost in email links). The
// requisición lives under the bitácora module route.
const WEB_BASE_URL = "https://sgcconstructorasd.com";
const REQUISICION_WEB_PATH = "/bitacora/solicitudes-material";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// solicitante/proyecto nombres are user-controlled text (a profile name, a
// project name) interpolated into HTML sent to real inboxes — escape before
// building the email body.
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

interface RequisicionItem {
  descripcion: string;
  cantidad: number;
  unidad: string | null;
}

// es-DO date/time, e.g. "20/08/2026, 03:45 p. m."
function formatFechaHora(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("es-DO", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "America/Santo_Domingo",
    });
  } catch {
    return iso;
  }
}

function formatCantidad(n: number): string {
  // Trim trailing zeros: 5.00 → "5", 2.50 → "2.5".
  return Number.isFinite(n) ? String(Number(n)) : String(n);
}

// Minimal one-page requisición PDF built with pdf-lib (pure JS, Deno-friendly).
// Returns base64 for the Resend attachment. Kept simple on purpose: header,
// metadata block, an items table drawn as rows, and a notes footer.
async function buildRequisicionPdf(params: {
  proyecto: string;
  solicitante: string;
  urgencia: string;
  fechaHora: string;
  notas: string | null;
  items: RequisicionItem[];
}): Promise<string> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595.28, 841.89]); // A4 portrait
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);

  const margin = 48;
  const width = page.getWidth();
  let y = page.getHeight() - margin;

  const ink = rgb(0.07, 0.07, 0.07);
  const muted = rgb(0.4, 0.4, 0.4);
  const line = rgb(0.8, 0.8, 0.8);
  const hubAmber = rgb(1, 0.7, 0);

  // AS6 — pdf-lib's StandardFonts (Helvetica) are WinAnsi-encoded. Normal Spanish
  // (á/é/ñ/ü…) is fine, but a stray out-of-range char (emoji, exotic unicode in a
  // material description) would THROW and drop the whole PDF. Sanitize to WinAnsi
  // so the PDF always renders: keep Latin-1, replace common punctuation, drop the rest.
  const toWinAnsi = (s: string) =>
    (s ?? "")
      .replace(/[‘’‚′]/g, "'")
      .replace(/[“”„″]/g, '"')
      .replace(/[–—]/g, "-")
      .replace(/…/g, "...")
      .replace(/[^\x09\x0A\x0D\x20-\xFF]/g, "");

  const draw = (text: string, x: number, yy: number, size: number, bold = false, color = ink) => {
    page.drawText(toWinAnsi(text), { x, y: yy, size, font: bold ? fontBold : font, color });
  };

  // Header
  draw("CONSTRUCTORA SD", margin, y, 18, true);
  y -= 20;
  draw("Requisición de materiales", margin, y, 12, false, muted);
  y -= 8;
  page.drawRectangle({ x: margin, y: y - 4, width: width - margin * 2, height: 3, color: hubAmber });
  y -= 28;

  // Metadata block
  const metaRows: Array<[string, string]> = [
    ["Obra / Proyecto:", params.proyecto],
    ["Solicitante:", params.solicitante],
    ["Urgencia:", params.urgencia],
    ["Fecha y hora:", params.fechaHora],
  ];
  for (const [label, value] of metaRows) {
    draw(label, margin, y, 10, true);
    draw(value, margin + 110, y, 10);
    y -= 18;
  }
  y -= 10;

  // Items table header
  const colDesc = margin;
  const colCant = width - margin - 170;
  const colUnid = width - margin - 90;
  draw("Artículo / Descripción", colDesc, y, 10, true);
  draw("Cantidad", colCant, y, 10, true);
  draw("Unidad", colUnid, y, 10, true);
  y -= 6;
  page.drawLine({ start: { x: margin, y }, end: { x: width - margin, y }, thickness: 1, color: line });
  y -= 16;

  // Items rows. A single A4 page fits ~35 rows given the header/notes budget;
  // if a requisición somehow has more, cap and note the remainder rather than
  // spilling off-page (keeps the generator dependency-light and one-page).
  const maxRows = 35;
  const shownItems = params.items.slice(0, maxRows);
  for (const it of shownItems) {
    const desc = it.descripcion ?? "—";
    const descLine = desc.length > 60 ? desc.slice(0, 57) + "…" : desc;
    draw(descLine, colDesc, y, 10);
    draw(formatCantidad(it.cantidad), colCant, y, 10);
    draw(it.unidad ?? "—", colUnid, y, 10);
    y -= 16;
  }
  if (params.items.length > maxRows) {
    draw(`… y ${params.items.length - maxRows} artículo(s) más`, colDesc, y, 9, false, muted);
    y -= 16;
  }

  y -= 6;
  page.drawLine({ start: { x: margin, y }, end: { x: width - margin, y }, thickness: 0.5, color: line });
  y -= 24;

  // Notes
  if (params.notas && params.notas.trim()) {
    draw("Notas:", margin, y, 10, true);
    y -= 16;
    const words = params.notas.trim().split(/\s+/);
    let currentLine = "";
    const maxChars = 90;
    for (const w of words) {
      if ((currentLine + " " + w).trim().length > maxChars) {
        draw(currentLine, margin, y, 10, false, muted);
        y -= 14;
        currentLine = w;
      } else {
        currentLine = (currentLine + " " + w).trim();
      }
    }
    if (currentLine) draw(currentLine, margin, y, 10, false, muted);
  }

  const bytes = await doc.save();
  // Base64 encode the PDF bytes for the Resend attachment.
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    // This isn't a privileged action (it only ever sends an informational
    // email reflecting real, already-persisted state — see the
    // estado-matches-evento check below), so unlike the admin-* functions
    // there's no is_admin()/module check here. Still requires a real,
    // valid session — not just "reachable" — matching verify_jwt=true at
    // the platform level with an explicit check in code too.
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return json({ error: "No autenticado." }, 401);
    }
    const callerClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: callerData, error: callerError } = await callerClient.auth.getUser();
    if (callerError || !callerData.user) {
      return json({ error: "Sesión inválida." }, 401);
    }

    const { tipo, solicitudId, evento } = await req.json();

    if (
      !["material", "compra"].includes(tipo) ||
      !["creada", "aprobada", "rechazada"].includes(evento) ||
      !solicitudId
    ) {
      return json({ error: "Parámetros inválidos." }, 400);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { db: { schema: "sgc" } },
    );

    const { data: resendApiKey } = await supabase.rpc("get_resend_api_key");
    if (!resendApiKey) {
      return json({ skipped: true, reason: "Resend API key no configurada en Vault." });
    }
    const fromEmail = Deno.env.get("NOTIFICATIONS_FROM_EMAIL") ?? "notificaciones@resend.dev";

    const table = tipo === "material" ? "solicitudes_material" : "solicitudes_compra";
    const fkey =
      tipo === "material" ? "solicitudes_material_solicitante_id_fkey" : "solicitudes_compra_solicitante_id_fkey";

    const { data: solicitud, error } = await supabase
      .from(table)
      .select(`*, proyecto:proyectos(nombre), solicitante:usuarios!${fkey}(nombre, email)`)
      .eq("id", solicitudId)
      .single();

    if (error || !solicitud) {
      return json({ error: error?.message ?? "Solicitud no encontrada." }, 404);
    }

    // Confirm the event actually happened (persisted state matches) before
    // notifying — a caller can't spoof "tu solicitud fue aprobada" for a
    // request that's still pending.
    if (evento === "aprobada") {
      const expected = tipo === "material" ? "entregada" : "convertida";
      if (solicitud.estado !== expected) {
        return json({ skipped: true, reason: "Estado no coincide con el evento." });
      }
    }
    if (evento === "rechazada" && solicitud.estado !== "rechazada") {
      return json({ skipped: true, reason: "Estado no coincide con el evento." });
    }

    const tipoLabel = tipo === "material" ? "materiales" : "compra";
    const solicitanteNombreRaw = solicitud.solicitante?.nombre ?? "Un ingeniero de campo";
    const proyectoNombreRaw = solicitud.proyecto?.nombre ?? "—";
    const urgenciaRaw = solicitud.urgencia === "urgente" ? "Urgente" : "Normal";
    const solicitanteNombre = escapeHtml(solicitanteNombreRaw);
    const proyectoNombre = escapeHtml(proyectoNombreRaw);
    let to: string[] = [];
    let subject = "";
    let html = "";
    // Resend attachment payload (only the requisición PDF, when it builds).
    let attachments: Array<{ filename: string; content: string }> | undefined;

    if (evento === "creada") {
      if (tipo === "material") {
        // Recipient matrix (NOT broadcast): módulo inventario + roles de proyecto
        // que gestionan requisiciones (mirror de puede_ver_todas_requisiciones).
        const { data: usuarios } = await supabase.rpc("usuarios_destinatarios_requisicion");
        to = ((usuarios ?? []) as { email: string }[]).map((u) => u.email).filter(Boolean);

        // Load items for the summary + PDF.
        const { data: itemsData } = await supabase
          .from("solicitud_material_items")
          .select("descripcion, cantidad, unidad")
          .eq("solicitud_id", solicitudId);
        const items = ((itemsData ?? []) as RequisicionItem[]);

        const fechaHora = formatFechaHora(solicitud.created_at ?? null);
        // AS6 — deep-link POR ID a la bandeja global de requisiciones: el gestor
        // abre directamente ESA requisición (drawer) para verla y aprobar/rechazar,
        // en vez de aterrizar en la bandeja genérica. Login enforced por la app.
        const detalleUrl = `${WEB_BASE_URL}/inventario/requisiciones?req=${solicitudId}`;

        // Enriched HTML body: metadata + items table + notas + "Ver detalle".
        const filas = items.length
          ? items
              .map(
                (it) =>
                  `<tr>` +
                  `<td style="padding:6px 10px;border-bottom:1px solid #eee;">${escapeHtml(it.descripcion ?? "—")}</td>` +
                  `<td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right;">${escapeHtml(formatCantidad(it.cantidad))}</td>` +
                  `<td style="padding:6px 10px;border-bottom:1px solid #eee;">${escapeHtml(it.unidad ?? "—")}</td>` +
                  `</tr>`,
              )
              .join("")
          : `<tr><td colspan="3" style="padding:6px 10px;color:#888;">Sin artículos.</td></tr>`;

        subject = `Nueva requisición de ${tipoLabel} — ${proyectoNombre}`;
        html =
          `<div style="font-family:Arial,Helvetica,sans-serif;color:#222;max-width:640px;">` +
          `<p><strong>${solicitanteNombre}</strong> creó una requisición de ${tipoLabel}.</p>` +
          `<table style="border-collapse:collapse;margin:12px 0;">` +
          `<tr><td style="padding:2px 12px 2px 0;color:#666;">Obra</td><td><strong>${proyectoNombre}</strong></td></tr>` +
          `<tr><td style="padding:2px 12px 2px 0;color:#666;">Solicitante</td><td>${solicitanteNombre}</td></tr>` +
          `<tr><td style="padding:2px 12px 2px 0;color:#666;">Urgencia</td><td>${escapeHtml(urgenciaRaw)}</td></tr>` +
          `<tr><td style="padding:2px 12px 2px 0;color:#666;">Fecha y hora</td><td>${escapeHtml(fechaHora)}</td></tr>` +
          `</table>` +
          `<table style="border-collapse:collapse;width:100%;font-size:14px;">` +
          `<thead><tr style="background:#f5f5f5;">` +
          `<th style="padding:6px 10px;text-align:left;border-bottom:2px solid #ddd;">Artículo / Descripción</th>` +
          `<th style="padding:6px 10px;text-align:right;border-bottom:2px solid #ddd;">Cantidad</th>` +
          `<th style="padding:6px 10px;text-align:left;border-bottom:2px solid #ddd;">Unidad</th>` +
          `</tr></thead><tbody>${filas}</tbody></table>` +
          (solicitud.notas && String(solicitud.notas).trim()
            ? `<p style="margin-top:12px;"><strong>Notas:</strong> ${escapeHtml(String(solicitud.notas))}</p>`
            : "") +
          `<p style="margin-top:20px;">` +
          `<a href="${detalleUrl}" style="background:#ffb300;color:#121212;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:bold;display:inline-block;">Ver detalle</a>` +
          `</p>` +
          `<p style="color:#888;font-size:12px;">Adjuntamos el PDF de la requisición. Requiere iniciar sesión en SGC para ver el detalle completo.</p>` +
          `</div>`;

        // PDF attachment — best-effort. If pdf-lib fails we still send the HTML.
        try {
          const base64 = await buildRequisicionPdf({
            proyecto: proyectoNombreRaw,
            solicitante: solicitanteNombreRaw,
            urgencia: urgenciaRaw,
            fechaHora,
            notas: solicitud.notas ?? null,
            items,
          });
          attachments = [{ filename: `requisicion-${String(solicitudId).slice(0, 8)}.pdf`, content: base64 }];
        } catch (pdfErr) {
          console.error("notificar-solicitud: PDF generation failed, sending HTML only", pdfErr);
        }
      } else {
        // Solicitud de compra: recipients por módulo compras (sin PDF de items).
        const { data: usuarios } = await supabase.rpc("usuarios_con_modulo", { p_modulo: "compras" });
        to = ((usuarios ?? []) as { email: string }[]).map((u) => u.email).filter(Boolean);
        subject = `Nueva solicitud de ${tipoLabel} — ${proyectoNombre}`;
        html = `<p><strong>${solicitanteNombre}</strong> solicitó ${tipoLabel} para el proyecto <strong>${proyectoNombre}</strong>.</p><p>Ingresa a SGC para revisarla.</p>`;
      }
    } else {
      const email = solicitud.solicitante?.email;
      if (email) to = [email];
      const estadoLabel = evento === "aprobada" ? "aprobada" : "rechazada";
      subject = `Tu solicitud de ${tipoLabel} fue ${estadoLabel}`;
      html = `<p>Tu solicitud de ${tipoLabel} para el proyecto <strong>${proyectoNombre}</strong> fue <strong>${estadoLabel}</strong>.</p><p>Ingresa a SGC para ver el detalle.</p>`;
    }

    if (to.length === 0) {
      return json({ skipped: true, reason: "Sin destinatarios." });
    }

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from: fromEmail, to, subject, html, ...(attachments ? { attachments } : {}) }),
    });

    if (!res.ok) {
      const text = await res.text();
      return json({ error: `Resend error: ${text}` }, 502);
    }

    return json({ sent: true, to });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Error desconocido." }, 500);
  }
});
