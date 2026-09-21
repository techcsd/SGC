import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { ajustarCorreoResend } from "../_shared/entorno.ts";

// Email alert when the CSD field app reports an incidente/accidente. Called by
// the app right after the bitácora (tipo=incidente) is created. Mirrors
// notificar-solicitud: Resend key from Vault (no-ops if unset), session
// required. Recipients: the incident project's team + admins, each filtered
// through destinatarios_notificacion(tipo='incidente', 'email') so user
// silences and admin notification rules are respected; excluded recipients are
// recorded in notif_entregas for traceability. A missing notification must
// never block the field workflow — the incident is already persisted in SGC.

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

    // Este email representa el evento de notificación tipo 'incidente'.
    const tipo = "incidente";

    // Recipients: the incident PROJECT's team (supervisores/ingenieros asignados
    // a esa obra) + admins for oversight. Ambos conjuntos se filtran por
    // destinatarios_notificacion (silencios de usuario + reglas de admin); las
    // filas excluidas se conservan para registrarlas como omitidas.
    const { data: teamRows } = bitacora.proyecto_id
      ? await supabase
          .from("proyecto_empleados")
          .select("empleado:empleados(activo, usuario:usuarios(id))")
          .eq("proyecto_id", bitacora.proyecto_id)
      : { data: [] as unknown[] };
    const teamIds = [
      ...new Set(
        ((teamRows ?? []) as Array<{ empleado: { activo: boolean; usuario: { id: string } | null } | null }>)
          .filter((r) => r.empleado?.activo !== false)
          .map((r) => r.empleado?.usuario?.id)
          .filter((id): id is string => !!id),
      ),
    ];

    type DestRow = { usuario_id: string; email: string; nombre: string; excluido_por: string | null };
    const [teamDest, adminDest] = await Promise.all([
      teamIds.length
        ? supabase.rpc("destinatarios_notificacion", { p_tipo: tipo, p_usuarios: teamIds, p_canal: "email" })
        : Promise.resolve({ data: [] as DestRow[] }),
      supabase.rpc("destinatarios_notificacion", { p_tipo: tipo, p_modulo: "admin", p_canal: "email" }),
    ]);
    // Une equipo + admins y deduplica por usuario_id.
    const byUser = new Map<string, DestRow>();
    for (const r of [...((teamDest.data ?? []) as DestRow[]), ...((adminDest.data ?? []) as DestRow[])]) {
      if (r && r.usuario_id && !byUser.has(r.usuario_id)) byUser.set(r.usuario_id, r);
    }
    const rows = [...byUser.values()];
    const incluidos = rows.filter((r) => !r.excluido_por && r.email);
    const to = [...new Set(incluidos.map((r) => r.email))];
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
      body: JSON.stringify(ajustarCorreoResend({ from: fromEmail, to, subject, html })),
    });
    if (!res.ok) return json({ error: `Resend error: ${await res.text()}` }, 502);

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
