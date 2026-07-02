import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Basic email notifications for the solicitudes workflow. Called directly
// by the frontend right after a solicitud is created/approved/rejected —
// no DB webhook/pg_net involved, deliberately simple for a first version.
// Requires a Resend account: set RESEND_API_KEY (and optionally
// NOTIFICATIONS_FROM_EMAIL, must be a verified sending address/domain in
// Resend) as function secrets via `supabase secrets set` or the dashboard.
// If RESEND_API_KEY isn't set yet, this no-ops instead of failing — a
// missing notification should never block the real workflow.

Deno.serve(async (req: Request) => {
  try {
    const { tipo, solicitudId, evento } = await req.json();

    if (
      !["material", "compra"].includes(tipo) ||
      !["creada", "aprobada", "rechazada"].includes(evento) ||
      !solicitudId
    ) {
      return new Response(JSON.stringify({ error: "Parámetros inválidos." }), { status: 400 });
    }

    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    if (!resendApiKey) {
      return new Response(JSON.stringify({ skipped: true, reason: "RESEND_API_KEY no configurada." }), {
        status: 200,
      });
    }
    const fromEmail = Deno.env.get("NOTIFICATIONS_FROM_EMAIL") ?? "notificaciones@resend.dev";

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { db: { schema: "sgc" } },
    );

    const table = tipo === "material" ? "solicitudes_material" : "solicitudes_compra";
    const fkey =
      tipo === "material" ? "solicitudes_material_solicitante_id_fkey" : "solicitudes_compra_solicitante_id_fkey";

    const { data: solicitud, error } = await supabase
      .from(table)
      .select(`*, proyecto:proyectos(nombre), solicitante:usuarios!${fkey}(nombre, email)`)
      .eq("id", solicitudId)
      .single();

    if (error || !solicitud) {
      return new Response(JSON.stringify({ error: error?.message ?? "Solicitud no encontrada." }), { status: 404 });
    }

    // Confirm the event actually happened (persisted state matches) before
    // notifying — a caller can't spoof "tu solicitud fue aprobada" for a
    // request that's still pending.
    if (evento === "aprobada") {
      const expected = tipo === "material" ? "entregada" : "convertida";
      if (solicitud.estado !== expected) {
        return new Response(JSON.stringify({ skipped: true, reason: "Estado no coincide con el evento." }), {
          status: 200,
        });
      }
    }
    if (evento === "rechazada" && solicitud.estado !== "rechazada") {
      return new Response(JSON.stringify({ skipped: true, reason: "Estado no coincide con el evento." }), {
        status: 200,
      });
    }

    const tipoLabel = tipo === "material" ? "materiales" : "compra";
    let to: string[] = [];
    let subject = "";
    let html = "";

    if (evento === "creada") {
      const modulo = tipo === "material" ? "inventario" : "compras";
      const { data: usuarios } = await supabase.rpc("usuarios_con_modulo", { p_modulo: modulo });
      to = ((usuarios ?? []) as { email: string }[]).map((u) => u.email).filter(Boolean);
      subject = `Nueva solicitud de ${tipoLabel} — ${solicitud.proyecto?.nombre ?? "Proyecto"}`;
      html = `<p><strong>${solicitud.solicitante?.nombre ?? "Un ingeniero de campo"}</strong> solicitó ${tipoLabel} para el proyecto <strong>${solicitud.proyecto?.nombre ?? "—"}</strong>.</p><p>Ingresa a SGC para revisarla.</p>`;
    } else {
      const email = solicitud.solicitante?.email;
      if (email) to = [email];
      const estadoLabel = evento === "aprobada" ? "aprobada" : "rechazada";
      subject = `Tu solicitud de ${tipoLabel} fue ${estadoLabel}`;
      html = `<p>Tu solicitud de ${tipoLabel} para el proyecto <strong>${solicitud.proyecto?.nombre ?? "—"}</strong> fue <strong>${estadoLabel}</strong>.</p><p>Ingresa a SGC para ver el detalle.</p>`;
    }

    if (to.length === 0) {
      return new Response(JSON.stringify({ skipped: true, reason: "Sin destinatarios." }), { status: 200 });
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
      return new Response(JSON.stringify({ error: `Resend error: ${text}` }), { status: 502 });
    }

    return new Response(JSON.stringify({ sent: true, to }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Error desconocido." }), {
      status: 500,
    });
  }
});
