import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Email alert when the CSD field app reports an incidente/accidente. Called by
// the app right after the bitácora (tipo=incidente) is created. Mirrors
// notificar-solicitud: Resend key from Vault (no-ops if unset), recipients via
// usuarios_con_modulo, session required. A missing notification must never
// block the field workflow — the incident is already persisted in SGC.

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
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "No autenticado." }, 401);

    const callerClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: callerData, error: callerError } = await callerClient.auth.getUser();
    if (callerError || !callerData.user) return json({ error: "Sesión inválida." }, 401);

    const { bitacoraId } = await req.json();
    if (!bitacoraId) return json({ error: "Parámetros inválidos." }, 400);

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

    const { data: bitacora, error } = await supabase
      .from("bitacoras")
      .select(
        "id, tipo, fecha, proyecto_id, incidente_tipo, incidente_gravedad, incidente_lesionados, incidente_descripcion, proyecto:proyectos(nombre), usuario:usuarios(nombre)",
      )
      .eq("id", bitacoraId)
      .single();

    if (error || !bitacora) return json({ error: error?.message ?? "Bitácora no encontrada." }, 404);
    // Only notify for real, persisted incidents (can't spoof an alert).
    if (bitacora.tipo !== "incidente") {
      return json({ skipped: true, reason: "La bitácora no es un incidente." });
    }

    // Recipients: the incident PROJECT's team (supervisores/ingenieros asignados
    // a esa obra) + admins for oversight. Dedup emails.
    const [teamRes, adminRes] = await Promise.all([
      bitacora.proyecto_id
        ? supabase
            .from("proyecto_empleados")
            .select("empleado:empleados(activo, usuario:usuarios(email))")
            .eq("proyecto_id", bitacora.proyecto_id)
        : Promise.resolve({ data: [] as unknown[] }),
      supabase.rpc("usuarios_con_modulo", { p_modulo: "admin" }),
    ]);
    const teamEmails = ((teamRes.data ?? []) as Array<{ empleado: { activo: boolean; usuario: { email: string } | null } | null }>)
      .filter((r) => r.empleado?.activo !== false)
      .map((r) => r.empleado?.usuario?.email)
      .filter((e): e is string => !!e);
    const adminEmails = ((adminRes.data ?? []) as { email: string }[]).map((u) => u.email).filter(Boolean);
    const to = [...new Set([...teamEmails, ...adminEmails])];
    if (to.length === 0) return json({ skipped: true, reason: "Sin destinatarios." });

    const proyecto = escapeHtml(bitacora.proyecto?.nombre ?? "—");
    const reporta = escapeHtml(bitacora.usuario?.nombre ?? "Personal de campo");
    const tipoInc = escapeHtml(bitacora.incidente_tipo ?? "incidente");
    const gravedad = escapeHtml(bitacora.incidente_gravedad ?? "—");
    const heridos = Number(bitacora.incidente_lesionados ?? 0);
    const desc = escapeHtml(bitacora.incidente_descripcion ?? "");
    const heridosTxt = heridos > 0 ? ` · ⚠️ ${heridos} herido(s)` : "";

    const subject = `🚨 ${tipoInc.toUpperCase()} en ${proyecto} (${gravedad})${heridosTxt}`;
    const html =
      `<p><strong>${reporta}</strong> reportó un <strong>${tipoInc}</strong> en la obra <strong>${proyecto}</strong>.</p>` +
      `<p>Gravedad: <strong>${gravedad}</strong>${heridos > 0 ? ` — <strong>${heridos} herido(s)</strong>` : ""}.</p>` +
      (desc ? `<p>${desc}</p>` : "") +
      `<p>Ingresa a SGC → Bitácora para ver el detalle y las fotos.</p>`;

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendApiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: fromEmail, to, subject, html }),
    });
    if (!res.ok) return json({ error: `Resend error: ${await res.text()}` }, 502);

    return json({ sent: true, to });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Error desconocido." }, 500);
  }
});
