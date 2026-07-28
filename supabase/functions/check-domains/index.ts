import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Y17 — check-domains (SGC-CSI-MOD-01). Corre checks sin API keys: DoH
// (dns.google) para resolución/MX/SPF/DKIM + RDAP (rdap.org) para clientHold y
// expiración + HTTP para web-up/SSL. Inserta en domain_checks, crea/actualiza
// alertas SOLO en cambio de estado (dedup en sgc.raise_infra_alert) y envía
// Telegram. Lo invoca pg_cron vía net.http_post con x-sync-secret. --no-verify-jwt.

type Status = "ok" | "warning" | "critical";
type Sev = "info" | "media" | "alta" | "critica";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

async function doh(name: string, type: string): Promise<{ Status: number; Answer?: { data: string }[] }> {
  const r = await fetch(`https://dns.google/resolve?name=${encodeURIComponent(name)}&type=${type}`, {
    headers: { accept: "application/dns-json" },
  });
  return await r.json();
}

function cleanHost(s: string): string {
  return s.replace(/^\d+\s+/, "").replace(/\.$/, "").toLowerCase().trim();
}

// Umbral de expiración → severidad (notas §2).
function expirySeverity(days: number): Sev | null {
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

  const { data: domains } = await sb.from("monitored_domains").select("*").eq("is_active", true);
  const results: unknown[] = [];

  for (const d of (domains ?? []) as Record<string, unknown>[]) {
    const domain = d.domain as string;
    const id = d.id as string;
    const checks: { type: string; status: Status; detail: string; raw?: unknown }[] = [];
    let expires: string | null = null;

    // Helper para registrar aviso + notificar.
    const raise = async (alertType: string, sev: Sev, msg: string) => {
      const { data } = await sb.rpc("raise_infra_alert", {
        p_source_type: "domain", p_source_id: id, p_alert_type: alertType, p_severity: sev, p_message: msg,
      });
      const res = data as { alert_id: string; should_notify: boolean } | null;
      if (res?.should_notify) {
        const ch = await sendTelegram(`${SEV_PREFIX[sev]} <b>${domain}</b>\n${msg}`);
        await sb.rpc("mark_alert_notified", { p_alert_id: res.alert_id, p_channels: [ch] });
      }
    };
    const resolve = (alertType: string) =>
      sb.rpc("resolve_infra_alert", { p_source_type: "domain", p_source_id: id, p_alert_type: alertType });

    // 1) DNS resolution (A) — NXDOMAIN fatal
    try {
      const a = await doh(domain, "A");
      if (a.Status === 3 || !(a.Answer && a.Answer.length)) {
        checks.push({ type: "dns_resolution", status: "critical", detail: "NXDOMAIN / sin registros A", raw: a });
        await raise("dns_down", "critica", "El dominio no resuelve (NXDOMAIN). Web y correo caídos.");
      } else {
        checks.push({ type: "dns_resolution", status: "ok", detail: `${a.Answer.length} registro(s) A`, raw: a });
        await resolve("dns_down");
      }
    } catch (e) {
      checks.push({ type: "dns_resolution", status: "critical", detail: `Error DoH: ${e}` });
    }

    // 2) MX vs expected
    try {
      const mx = await doh(domain, "MX");
      const hosts = (mx.Answer ?? []).map((x) => cleanHost(x.data));
      const expected = ((d.expected_mx as string[]) ?? []).map((s) => s.toLowerCase());
      const missing = expected.filter((e) => !hosts.some((h) => h.includes(e)));
      if (expected.length && missing.length) {
        checks.push({ type: "mx_records", status: "warning", detail: `MX faltantes: ${missing.join(", ")}`, raw: mx });
        await raise("mail_config", "media", `Registros MX no coinciden con lo esperado. Faltan: ${missing.join(", ")}.`);
      } else {
        checks.push({ type: "mx_records", status: "ok", detail: hosts.join(", ") || "sin MX", raw: mx });
        await resolve("mail_config");
      }
    } catch (e) {
      checks.push({ type: "mx_records", status: "warning", detail: `Error: ${e}` });
    }

    // 3) SPF
    try {
      const txt = await doh(domain, "TXT");
      const records = (txt.Answer ?? []).map((x) => x.data.replace(/"/g, ""));
      const spf = records.find((r) => r.includes("v=spf1")) ?? "";
      const incs = (d.expected_spf_includes as string[]) ?? [];
      const missing = incs.filter((i) => !spf.includes(i));
      if (!spf) {
        checks.push({ type: "spf", status: "warning", detail: "Sin registro SPF" });
      } else if (missing.length) {
        checks.push({ type: "spf", status: "warning", detail: `SPF sin: ${missing.join(", ")}`, raw: { spf } });
      } else {
        checks.push({ type: "spf", status: "ok", detail: spf });
      }
    } catch (e) {
      checks.push({ type: "spf", status: "warning", detail: `Error: ${e}` });
    }

    // 4) DKIM (selector._domainkey)
    const selector = d.dkim_selector as string | null;
    if (selector) {
      try {
        const dk = await doh(`${selector}._domainkey.${domain}`, "TXT");
        const rec = (dk.Answer ?? []).map((x) => x.data.replace(/"/g, "")).join("");
        const ok = /v=DKIM1|p=/.test(rec);
        checks.push({ type: "dkim", status: ok ? "ok" : "warning", detail: ok ? "DKIM presente" : "DKIM ausente/pendiente", raw: { rec } });
      } catch (e) {
        checks.push({ type: "dkim", status: "warning", detail: `Error: ${e}` });
      }
    }

    // 5) RDAP — clientHold + expiración
    try {
      const r = await fetch(`https://rdap.org/domain/${domain}`, { headers: { accept: "application/rdap+json" } });
      if (r.ok) {
        const rd = await r.json();
        const statuses: string[] = (rd.status ?? []).map((s: string) => s.toLowerCase());
        const hold = statuses.some((s) => s.includes("hold"));
        const exp = (rd.events ?? []).find((e: { eventAction: string }) => e.eventAction === "expiration");
        if (exp?.eventDate) {
          expires = String(exp.eventDate).slice(0, 10);
          const days = Math.ceil((new Date(exp.eventDate).getTime() - Date.now()) / 86400000);
          const sev = expirySeverity(days);
          if (sev) await raise("domain_expiring", sev, `El dominio vence en ${days} día(s) (${expires}).`);
          else await resolve("domain_expiring");
        }
        if (hold) {
          checks.push({ type: "rdap_status", status: "critical", detail: `Estado registro: ${statuses.join(", ")}`, raw: rd });
          await raise("client_hold", "critica", `Dominio en estado fatal: ${statuses.join(", ")}. Renovar/desbloquear YA.`);
        } else {
          checks.push({ type: "rdap_status", status: "ok", detail: statuses.join(", ") || "activo", raw: { status: rd.status, events: rd.events } });
          await resolve("client_hold");
        }
      } else {
        checks.push({ type: "rdap_status", status: "warning", detail: `RDAP HTTP ${r.status}` });
      }
    } catch (e) {
      checks.push({ type: "rdap_status", status: "warning", detail: `Error RDAP: ${e}` });
    }

    // 6) HTTP/SSL — web responde 200 (un cert vencido rompe el fetch https → critical)
    if (d.check_ssl) {
      try {
        const r = await fetch(`https://${domain}`, { method: "GET", redirect: "manual" });
        const up = r.status > 0 && r.status < 500;
        checks.push({ type: "http", status: up ? "ok" : "critical", detail: `HTTP ${r.status}` });
        if (up) await resolve("web_down"); else await raise("web_down", "critica", `La web no responde (HTTP ${r.status}).`);
      } catch (e) {
        checks.push({ type: "http", status: "critical", detail: `Web/SSL caído: ${e}` });
        await raise("web_down", "critica", `La web no responde (posible SSL vencido o DNS caído).`);
      }
    }

    // Persistir checks + estado denormalizado.
    const rows = checks.map((c) => ({ domain_id: id, check_type: c.type, status: c.status, detail: c.detail, raw_response: c.raw ?? null }));
    if (rows.length) await sb.from("domain_checks").insert(rows);
    const worst: Status = checks.some((c) => c.status === "critical") ? "critical"
      : checks.some((c) => c.status === "warning") ? "warning" : "ok";
    await sb.rpc("set_domain_status", { p_domain_id: id, p_status: worst, p_expires: expires });

    results.push({ domain, status: worst, checks: checks.length, expires });
  }

  return json({ ok: true, domains: results });
});
