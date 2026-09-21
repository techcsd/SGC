import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { ajustarCorreoResend } from "../_shared/entorno.ts";

// AG14 — Notifica por EMAIL a admin/tecnología cuando entra un reporte/ticket de
// soporte nuevo. Llamada SERVER-TO-SERVER desde un trigger de BD vía pg_net con
// el shared-secret `x-sync-secret` (mismo patrón que send-push), NO desde el
// frontend. Debe desplegarse con verify_jwt=false.
//
// La Resend API key vive en Supabase Vault (sgc.get_resend_api_key), nunca en el
// cliente. Si falta la key o el secreto no coincide, no-opea en vez de fallar —
// una notificación perdida jamás debe romper el alta del ticket.
//
// Destinatarios: módulo admin filtrado por destinatarios_notificacion(tipo=
// 'soporte', 'email') — respeta silencios de usuario y reglas de admin; los
// excluidos se registran en notif_entregas para trazabilidad. Se conserva la
// casilla de Tecnología como red de seguridad forzada (siempre incluida).

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

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const TIPO_LABEL: Record<string, string> = {
  comentario: "Comentario",
  bug: "Reporte de error",
  sugerencia: "Sugerencia",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    // Auth server-to-server por shared-secret (no sesión de usuario).
    const secret = req.headers.get("x-sync-secret");
    const expected = Deno.env.get("INFRA_SYNC_SECRET");
    if (!expected || secret !== expected) {
      return json({ error: "No autorizado." }, 401);
    }

    const { reporte_id } = await req.json();
    if (!reporte_id) return json({ error: "Falta reporte_id." }, 400);

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

    const { data: reporte, error } = await supabase
      .from("reportes_usuario")
      .select("*, autor:usuarios!reportes_usuario_usuario_id_fkey(nombre, email)")
      .eq("id", reporte_id)
      .single();
    if (error || !reporte) {
      return json({ error: error?.message ?? "Reporte no encontrado." }, 404);
    }

    // Destinatarios: módulo admin (incluye tecnología por rol) filtrado por
    // silencios de usuario y reglas de admin. Este email es el evento tipo 'soporte'.
    const tipo = "soporte";
    const { data: dest } = await supabase.rpc("destinatarios_notificacion", {
      p_tipo: tipo,
      p_modulo: "admin",
      p_canal: "email",
    });
    const rows = (dest ?? []) as { usuario_id: string; email: string; nombre: string; excluido_por: string | null }[];
    const incluidos = rows.filter((r) => !r.excluido_por && r.email);
    let to = [...new Set(incluidos.map((r) => r.email))];
    // Siempre incluir la casilla de Tecnología como red de seguridad (forzada).
    if (!to.includes("Tecnologia@constructorasd.com")) to = [...to, "Tecnologia@constructorasd.com"];
    if (to.length === 0) return json({ skipped: true, reason: "Sin destinatarios." });

    const tipoLabel = TIPO_LABEL[reporte.tipo] ?? "Reporte";
    const autor = escapeHtml(reporte.autor?.nombre ?? "Un usuario");
    const asunto = escapeHtml(reporte.asunto ?? "(sin asunto)");
    const descripcion = escapeHtml(reporte.descripcion ?? "");
    const subject = `Nuevo ${tipoLabel.toLowerCase()} en SGC — ${asunto}`;
    const html =
      `<p><strong>${autor}</strong> envió un ${tipoLabel.toLowerCase()} en SGC.</p>` +
      `<p><strong>Asunto:</strong> ${asunto}</p>` +
      (descripcion ? `<p><strong>Detalle:</strong> ${descripcion}</p>` : "") +
      `<p>Ingresa a SGC → Soporte para responderlo.</p>`;

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendApiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(ajustarCorreoResend({ from: fromEmail, to, subject, html })),
    });
    if (!res.ok) {
      const text = await res.text();
      return json({ error: `Resend error: ${text}` }, 502);
    }

    // Traza de entrega (best-effort, nunca bloquea): incluidos + omitidos.
    try {
      const titulo = subject;
      const traza = [
        ...incluidos.map((r) => ({ canal: "email", usuario_id: r.usuario_id, tipo, titulo: String(titulo ?? ""), destino: r.email, estado: "enviada", motivo: null })),
        ...rows.filter((r) => r.excluido_por).map((r) => ({ canal: "email", usuario_id: r.usuario_id, tipo, titulo: String(titulo ?? ""), destino: r.email, estado: "omitida", motivo: r.excluido_por })),
      ];
      if (traza.length) await supabase.from("notif_entregas").insert(traza);
    } catch (_) { /* trace must never block */ }

    return json({ sent: true, to });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Error desconocido." }, 500);
  }
});
