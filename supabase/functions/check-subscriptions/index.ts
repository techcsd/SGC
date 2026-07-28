import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Y17 — check-subscriptions (SGC-CSI-MOD-01). Recorre subscriptions, calcula
// días restantes desde renewal_date y aplica los umbrales escalonados (notas §2).
// payment_ok=false = fatal inmediato. Crea/actualiza alertas SOLO en cambio de
// estado (dedup) y notifica por correo (primario, Resend desde sgcconstructorasd.com)
// + Telegram opcional. pg_cron vía net.http_post + x-sync-secret.

type Sev = "info" | "media" | "alta" | "critica";
// deno-lint-ignore no-explicit-any
type SB = any;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function renewalSeverity(days: number): Sev | null {
  if (days <= 7) return "critica";
  if (days <= 14) return "alta";
  if (days <= 30) return "media";
  if (days <= 60) return "info";
  return null;
}
const SEV_PREFIX: Record<Sev, string> = { info: "ℹ️", media: "🟡", alta: "🟠", critica: "🔴" };

async function recipients(sb: SB): Promise<string[]> {
  const cfg = (Deno.env.get("INFRA_ALERT_EMAILS") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (cfg.length) return cfg;
  const { data } = await sb.rpc("usuarios_con_modulo", { p_modulo: "tecnologia" });
  return [...new Set(((data ?? []) as { email: string }[]).map((u) => u.email).filter(Boolean))];
}
async function sendEmail(sb: SB, to: string[], subject: string, html: string): Promise<Record<string, unknown>> {
  if (!to.length) return { channel: "email", skipped: "sin destinatarios" };
  const { data: key } = await sb.rpc("get_resend_api_key");
  if (!key) return { channel: "email", skipped: "Resend key no configurada" };
  const from = Deno.env.get("NOTIFICATIONS_FROM_EMAIL") ?? "notificaciones@resend.dev";
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to, subject, html }),
    });
    return { channel: "email", ok: r.ok, at: new Date().toISOString() };
  } catch (e) {
    return { channel: "email", error: e instanceof Error ? e.message : "fail" };
  }
}
async function sendTelegram(text: string): Promise<Record<string, unknown> | null> {
  const token = Deno.env.get("TELEGRAM_BOT_TOKEN");
  const chatId = Deno.env.get("TELEGRAM_ALERT_CHAT_ID");
  if (!token || !chatId) return null;
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true }),
    });
    return { channel: "telegram", ok: r.ok };
  } catch (e) {
    return { channel: "telegram", error: e instanceof Error ? e.message : "fail" };
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204 });
  const secret = req.headers.get("x-sync-secret");
  if (!secret || secret !== Deno.env.get("INFRA_SYNC_SECRET")) return json({ error: "No autorizado." }, 401);

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { db: { schema: "sgc" } },
  );

  const to = await recipients(sb);
  const { data: subs } = await sb.from("subscriptions").select("*").eq("is_active", true);
  const results: unknown[] = [];

  const raise = async (id: string, alertType: string, sev: Sev, name: string, msg: string) => {
    const { data } = await sb.rpc("raise_infra_alert", {
      p_source_type: "subscription", p_source_id: id, p_alert_type: alertType, p_severity: sev, p_message: msg,
    });
    const res = data as { alert_id: string; should_notify: boolean } | null;
    if (res?.should_notify) {
      const channels: Record<string, unknown>[] = [];
      const subject = `${SEV_PREFIX[sev]} Alerta ${sev} · ${name}`;
      const html = `<h2 style="margin:0 0 8px">${SEV_PREFIX[sev]} ${esc(name)}</h2><p>${esc(msg)}</p>` +
        `<p style="margin-top:12px">SGC → Tecnología → Monitoreo de Infraestructura para reconocer la alerta.</p>`;
      channels.push(await sendEmail(sb, to, subject, html));
      const tg = await sendTelegram(`${SEV_PREFIX[sev]} <b>${name}</b>\n${msg}`);
      if (tg) channels.push(tg);
      await sb.rpc("mark_alert_notified", { p_alert_id: res.alert_id, p_channels: channels });
    }
  };
  const resolve = (id: string, alertType: string) =>
    sb.rpc("resolve_infra_alert", { p_source_type: "subscription", p_source_id: id, p_alert_type: alertType });

  for (const s of (subs ?? []) as Record<string, unknown>[]) {
    const id = s.id as string;
    const name = s.name as string;

    if (s.payment_ok === false) {
      await raise(id, "payment_failed", "critica", name, `Pago rechazado / método de pago con problema en ${s.provider ?? name}.`);
    } else {
      await resolve(id, "payment_failed");
    }

    if (s.renewal_date) {
      const days = Math.ceil((new Date(String(s.renewal_date) + "T00:00:00Z").getTime() - Date.now()) / 86400000);
      const sev = renewalSeverity(days);
      if (days < 0) {
        await raise(id, "renewal_overdue", "critica", name, `La suscripción venció hace ${Math.abs(days)} día(s) (${s.renewal_date}).`);
      } else if (sev) {
        await raise(id, "renewal_due", sev, name, `Renovación en ${days} día(s) (${s.renewal_date}). ${s.auto_renew ? "Auto-renovación activada." : "⚠️ Sin auto-renovación."}`);
        await resolve(id, "renewal_overdue");
      } else {
        await resolve(id, "renewal_due");
        await resolve(id, "renewal_overdue");
      }
      results.push({ name, days });
    } else {
      results.push({ name, days: null, note: "sin renewal_date" });
    }
  }

  return json({ ok: true, recipients: to.length, subscriptions: results });
});
