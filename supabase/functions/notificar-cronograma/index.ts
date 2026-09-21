import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { ajustarCorreoResend } from "../_shared/entorno.ts";

// Y15 — Email de avisos del Cronograma de Proyectos (por iniciar / por vencer /
// atrasada). Lo invoca el sweep pg_cron `sgc.evaluar_avisos_cronograma()` vía
// net.http_post con un secreto compartido (no hay sesión de usuario). El aviso
// in-app + el bell ya existen (los escribe el sweep). Destinatarios: los
// responsables activos del proyecto filtrados por destinatarios_notificacion
// (silencios de usuario + reglas de admin); los excluidos se registran en
// notif_entregas para trazabilidad. Resend key desde Vault; no-op si falta. Un
// email fallido NUNCA debe bloquear el flujo.
//
// Deploy: --no-verify-jwt (auth por header x-sync-secret == CRONOGRAMA_SYNC_SECRET).

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
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

const PREFIJO: Record<string, string> = {
  por_iniciar: "📅 Tarea por iniciar",
  por_vencer: "⏳ Tarea por vencer",
  atrasada: "🚨 Tarea atrasada",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    // Auth por secreto compartido (lo pone el sweep pg_cron).
    const secret = req.headers.get("x-sync-secret");
    const expected = Deno.env.get("CRONOGRAMA_SYNC_SECRET");
    if (!expected || secret !== expected) return json({ error: "No autorizado." }, 401);

    const { proyecto_id, tarea_id, tipo, tarea, proyecto, mensaje } = await req.json();
    if (!proyecto_id || !tipo) return json({ error: "Parámetros inválidos." }, 400);

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

    // Destinatarios: responsables activos del proyecto. Consulta directa con
    // service_role (bypassa RLS) para no depender de auth.uid() en un contexto de cron.
    const { data: resp } = await supabase
      .from("proyecto_responsables")
      .select("usuario_id")
      .eq("proyecto_id", proyecto_id)
      .eq("activo", true);
    const ids = [...new Set(((resp ?? []) as { usuario_id: string }[]).map((r) => r.usuario_id))];
    if (ids.length === 0) return json({ skipped: true, reason: "Sin responsables." });

    // Filtra la lista de responsables por silencios de usuario y reglas de admin.
    const { data: dest } = await supabase.rpc("destinatarios_notificacion", {
      p_tipo: tipo,
      p_usuarios: ids,
      p_canal: "email",
    });
    const rows = (dest ?? []) as { usuario_id: string; email: string; nombre: string; excluido_por: string | null }[];
    const incluidos = rows.filter((r) => !r.excluido_por && r.email);
    const to = [...new Set(incluidos.map((r) => r.email))];
    if (to.length === 0) return json({ skipped: true, reason: "Sin destinatarios." });

    const prefijo = PREFIJO[tipo as string] ?? "Aviso de cronograma";
    const subject = `${prefijo} · ${escapeHtml(String(proyecto ?? ""))}`;
    const html =
      `<h2 style="margin:0 0 8px">${escapeHtml(String(prefijo))}</h2>` +
      `<p>Proyecto: <strong>${escapeHtml(String(proyecto ?? ""))}</strong></p>` +
      (tarea ? `<p>Tarea: <strong>${escapeHtml(String(tarea))}</strong></p>` : "") +
      `<div>${escapeHtml(String(mensaje ?? ""))}</div>` +
      `<p style="margin-top:12px">Ingresa a SGC → Proyectos → Cronograma para gestionarla.</p>`;

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

    return json({ sent: true, to, tarea_id });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Error desconocido." }, 500);
  }
});
