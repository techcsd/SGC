import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Email alert for Flota v2 operational events (bloqueo, consumo anormal,
// pre-cita, mantenimiento vencido, vencimientos). Called by the SGC web/app
// right after the event is persisted (the in-app aviso + notification already
// exist via the RPC). Recipients: usuarios_con_modulo('flota'). Resend key from
// Vault (no-ops if unset). A failed email must NEVER block the flow.

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

// Prefijo de asunto por tipo de evento.
const PREFIJO: Record<string, string> = {
  bloqueo_critico: "🚫 VEHÍCULO BLOQUEADO",
  hallazgos: "⚠️ Pre-uso con hallazgos",
  pre_cita: "🔧 Agendar pre-cita",
  mantenimiento_vencido: "🔧 Mantenimiento vencido",
  consumo_anormal: "⛽ Consumo anormal",
  licencia: "🪪 Licencia por vencer",
  matricula: "📄 Matrícula por vencer",
  seguro: "🛡️ Seguro por vencer",
};

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

    const { tipo, titulo, detalleHtml, vehiculo, conductor } = await req.json();
    if (!tipo || !titulo) return json({ error: "Parámetros inválidos." }, 400);

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

    // Destinatarios: usuarios con el módulo flota (+ admins, ya incluidos por el RPC).
    const { data: recipients } = await supabase.rpc("usuarios_con_modulo", { p_modulo: "flota" });
    const to = [...new Set(((recipients ?? []) as { email: string }[]).map((u) => u.email).filter(Boolean))];
    if (to.length === 0) return json({ skipped: true, reason: "Sin destinatarios." });

    const prefijo = PREFIJO[tipo as string] ?? "Aviso de flota";
    const vehTxt = vehiculo ? ` · ${escapeHtml(String(vehiculo))}` : "";
    const subject = `${prefijo}${vehTxt}`;

    const detalle = detalleHtml ? String(detalleHtml) : escapeHtml(String(titulo));
    const condTxt = conductor ? `<p>Conductor: <strong>${escapeHtml(String(conductor))}</strong></p>` : "";
    const html =
      `<h2 style="margin:0 0 8px">${escapeHtml(String(titulo))}</h2>` +
      (vehiculo ? `<p>Vehículo: <strong>${escapeHtml(String(vehiculo))}</strong></p>` : "") +
      condTxt +
      `<div>${detalle}</div>` +
      `<p style="margin-top:12px">Ingresa a SGC → Flota → Avisos para gestionar este aviso.</p>`;

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
