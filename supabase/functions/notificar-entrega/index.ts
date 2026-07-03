import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Notifies inventario staff when a delivery is confirmed incomplete —
// closing the loop the other direction from notificar-solicitud (which
// notifies inventario when a request is CREATED). Same fire-and-forget,
// no-op-if-unconfigured design: a missing notification must never block
// the real confirmation workflow, and the caller doesn't wait on this.

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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const { salidaId } = await req.json();
    if (!salidaId) {
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

    const { data: salida, error } = await supabase
      .from("salidas_inventario")
      .select(
        "estado, notas_recepcion, proyecto:proyectos(nombre), recibido:usuarios!salidas_inventario_recibido_por_fkey(nombre), detalle_salidas(cantidad, cantidad_recibida, articulo:articulos(nombre))",
      )
      .eq("id", salidaId)
      .single();

    if (error || !salida) {
      return json({ error: error?.message ?? "Salida no encontrada." }, 404);
    }

    if (salida.estado !== "entregado_incompleto") {
      return json({ skipped: true, reason: "La entrega no está marcada como incompleta." });
    }

    const { data: usuarios } = await supabase.rpc("usuarios_con_modulo", { p_modulo: "inventario" });
    const to = ((usuarios ?? []) as { email: string }[]).map((u) => u.email).filter(Boolean);
    if (to.length === 0) {
      return json({ skipped: true, reason: "Sin destinatarios." });
    }

    const faltantes = (
      (salida.detalle_salidas ?? []) as { cantidad: number; cantidad_recibida: number | null; articulo?: { nombre: string } }[]
    )
      .filter((d) => d.cantidad_recibida == null || d.cantidad_recibida < d.cantidad)
      .map((d) => `<li>${d.articulo?.nombre ?? "Artículo"}: enviado ${d.cantidad}, recibido ${d.cantidad_recibida ?? 0}</li>`)
      .join("");

    const subject = `Entrega incompleta — ${salida.proyecto?.nombre ?? "Proyecto"}`;
    const html = `<p>Se confirmó una entrega <strong>incompleta</strong> para el proyecto <strong>${salida.proyecto?.nombre ?? "—"}</strong>, reportada por ${salida.recibido?.nombre ?? "el receptor"}.</p><ul>${faltantes}</ul>${salida.notas_recepcion ? `<p><strong>Nota:</strong> ${salida.notas_recepcion}</p>` : ""}<p>Ingresa a SGC para revisarla.</p>`;

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendApiKey}`, "Content-Type": "application/json" },
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
