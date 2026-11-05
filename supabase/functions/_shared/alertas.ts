// _shared/alertas.ts — DB2. Envío de alertas por correo (canal primario,
// mismo patrón que check-domains/check-subscriptions: Resend vía
// sgc.get_resend_api_key(), destinatarios INFRA_ALERT_EMAILS o el módulo
// tecnologia) + Telegram como canal EXTRA opcional (no hay integración
// Telegram real en este repo todavía — docs/SGC-CSI-MOD-01-monitoreo-
// infraestructura.md la deja "opcional, sin token"; esto implementa
// exactamente eso: si no hay TELEGRAM_BOT_TOKEN/TELEGRAM_ALERT_CHAT_ID, se
// omite en silencio, nunca bloquea el correo).
//
// Usado por wa-ingest (`evento` con nivel alerta/critico) y wa-extract
// (latido del listener, presupuesto de tokens agotado).

// deno-lint-ignore no-explicit-any
type SB = any;

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function destinatariosAlerta(sb: SB): Promise<string[]> {
  const cfg = (Deno.env.get("INFRA_ALERT_EMAILS") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (cfg.length) return cfg;
  const { data } = await sb.rpc("usuarios_con_modulo", { p_modulo: "tecnologia" });
  return [...new Set(((data ?? []) as { email: string }[]).map((u) => u.email).filter(Boolean))];
}

async function enviarCorreoAlerta(sb: SB, asunto: string, html: string): Promise<void> {
  try {
    const to = await destinatariosAlerta(sb);
    if (!to.length) return;
    const { data: key } = await sb.rpc("get_resend_api_key");
    if (!key) return;
    const from = Deno.env.get("NOTIFICATIONS_FROM_EMAIL") ?? "notificaciones@resend.dev";
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to, subject: asunto, html }),
    });
  } catch (e) {
    console.error("[alertas] correo falló:", e);
  }
}

async function enviarTelegramAlerta(texto: string): Promise<void> {
  const token = Deno.env.get("TELEGRAM_BOT_TOKEN");
  const chatId = Deno.env.get("TELEGRAM_ALERT_CHAT_ID");
  if (!token || !chatId) return; // canal opcional, sin configurar todavía — no-op
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: texto }),
    });
  } catch (e) {
    console.error("[alertas] Telegram falló:", e);
  }
}

export async function enviarAlerta(sb: SB, opts: {
  nivel: "alerta" | "critico";
  titulo: string;
  detalleHtml: string;
  detalleTexto: string;
}): Promise<void> {
  const prefijo = opts.nivel === "critico" ? "🔴 CRÍTICO" : "🟠 ALERTA";
  await Promise.all([
    enviarCorreoAlerta(sb, `${prefijo} — ${opts.titulo}`, `<h2>${esc(opts.titulo)}</h2>${opts.detalleHtml}`),
    enviarTelegramAlerta(`${prefijo} — ${opts.titulo}\n${opts.detalleTexto}`),
  ]);
}
