import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Basic email notifications for the solicitudes workflow. Called directly
// by the frontend right after a solicitud is created/approved/rejected —
// no DB webhook/pg_net involved, deliberately simple for a first version.
//
// The Resend API key is stored in Supabase Vault (see
// sql/2026-07-02-vault-resend-key.sql) rather than a plain
// RESEND_API_KEY env var — fetched here via sgc.get_resend_api_key(),
// which is only executable by service_role, so the key is never exposed
// to the Angular frontend. If the key isn't set yet, this no-ops instead
// of failing — a missing notification should never block the real
// workflow.

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
    const solicitanteNombre = escapeHtml(solicitud.solicitante?.nombre ?? "Un ingeniero de campo");
    const proyectoNombre = escapeHtml(solicitud.proyecto?.nombre ?? "—");
    let to: string[] = [];
    let subject = "";
    let html = "";

    if (evento === "creada") {
      const modulo = tipo === "material" ? "inventario" : "compras";
      const { data: usuarios } = await supabase.rpc("usuarios_con_modulo", { p_modulo: modulo });
      to = ((usuarios ?? []) as { email: string }[]).map((u) => u.email).filter(Boolean);
      subject = `Nueva solicitud de ${tipoLabel} — ${proyectoNombre}`;
      html = `<p><strong>${solicitanteNombre}</strong> solicitó ${tipoLabel} para el proyecto <strong>${proyectoNombre}</strong>.</p><p>Ingresa a SGC para revisarla.</p>`;
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
      body: JSON.stringify({ from: fromEmail, to, subject, html }),
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
