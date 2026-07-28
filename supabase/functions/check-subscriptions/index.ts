import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Y17 — check-subscriptions (SGC-CSI-MOD-01). Recorre subscriptions, calcula
// días restantes desde renewal_date y aplica los umbrales escalonados (notas §2).
// payment_ok=false = fatal inmediato. Crea/actualiza alertas SOLO en cambio de
// estado (dedup) y envía Telegram. pg_cron vía net.http_post + x-sync-secret.

type Sev = "info" | "media" | "alta" | "critica";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function renewalSeverity(days: number): Sev | null {
  if (days <= 7) return "critica";
  if (days <= 14) return "alta";
  if (days <= 30) return "media";
  if (days <= 60) return "info";
  return null;
}

async function sendTelegram(text: string): Promise<Record<string, unknown>> {
  const token = Deno.env.get("TELEGRAM_BOT_TOKEN");
  const chatId = Deno.env.get("TELEGRAM_ALERT_CHAT_ID");
  if (!token || !chatId) return { channel: "telegram", skipped: "TELEGRAM_BOT_TOKEN/CHAT_ID no configurados" };
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true }),
    });
    return { channel: "telegram", ok: r.ok, at: new Date().toISOString() };
  } catch (e) {
    return { channel: "telegram", error: e instanceof Error ? e.message : "fail" };
  }
}

const SEV_PREFIX: Record<Sev, string> = { info: "ℹ️", media: "🟡", alta: "🟠", critica: "🔴" };

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204 });
  const secret = req.headers.get("x-sync-secret");
  if (!secret || secret !== Deno.env.get("INFRA_SYNC_SECRET")) return json({ error: "No autorizado." }, 401);

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { db: { schema: "sgc" } },
  );

  const { data: subs } = await sb.from("subscriptions").select("*").eq("is_active", true);
  const results: unknown[] = [];

  const raise = async (id: string, alertType: string, sev: Sev, name: string, msg: string) => {
    const { data } = await sb.rpc("raise_infra_alert", {
      p_source_type: "subscription", p_source_id: id, p_alert_type: alertType, p_severity: sev, p_message: msg,
    });
    const res = data as { alert_id: string; should_notify: boolean } | null;
    if (res?.should_notify) {
      const ch = await sendTelegram(`${SEV_PREFIX[sev]} <b>${name}</b>\n${msg}`);
      await sb.rpc("mark_alert_notified", { p_alert_id: res.alert_id, p_channels: [ch] });
    }
  };
  const resolve = (id: string, alertType: string) =>
    sb.rpc("resolve_infra_alert", { p_source_type: "subscription", p_source_id: id, p_alert_type: alertType });

  for (const s of (subs ?? []) as Record<string, unknown>[]) {
    const id = s.id as string;
    const name = s.name as string;

    // Pago rechazado = fatal inmediato.
    if (s.payment_ok === false) {
      await raise(id, "payment_failed", "critica", name, `Pago rechazado / método de pago con problema en ${s.provider ?? name}.`);
    } else {
      await resolve(id, "payment_failed");
    }

    // Vencimiento por fecha de renovación.
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

  return json({ ok: true, subscriptions: results });
});
