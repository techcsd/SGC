// AF7 — send-push: envía notificaciones push (FCM) a los device tokens de una
// lista de usuarios. Invocada server-to-server por sgc.send_push (pg_net) con el
// secreto compartido `infra_sync_secret` (patrón Y17). No-op si faltan las
// credenciales FCM (env FCM_SERVICE_ACCOUNT_JSON), igual que Resend/Vault.
//
// Android: FCM nativo. iOS PWA: Web Push tiene límites (sólo con app instalada en
// iOS 16.4+); el fallback es la notificación in-app (sgc.notificaciones) que ya
// se inserta en paralelo. Web: tokens FCM web opcionales.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

// ── OAuth2 access token desde el service account (FCM HTTP v1) ───────────────
function pemToArrayBuffer(pem: string): ArrayBuffer {
  const b64 = pem.replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "").replace(/\s+/g, "");
  const bin = atob(b64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}
function b64url(data: Uint8Array | string): string {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function getAccessToken(sa: { client_email: string; private_key: string }): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claim = {
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };
  const unsigned = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claim))}`;
  const key = await crypto.subtle.importKey(
    "pkcs8", pemToArrayBuffer(sa.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned)));
  const jwt = `${unsigned}.${b64url(sig)}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });
  const data = await res.json();
  if (!data.access_token) throw new Error("No se pudo obtener access_token de Google");
  return data.access_token as string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204 });

  const secret = req.headers.get("x-sync-secret");
  if (!secret || secret !== Deno.env.get("INFRA_SYNC_SECRET")) {
    return json({ error: "No autorizado." }, 401);
  }

  const { user_ids, titulo, cuerpo, data } = await req.json().catch(() => ({}));
  if (!Array.isArray(user_ids) || user_ids.length === 0) {
    return json({ skipped: true, reason: "Sin destinatarios." });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { db: { schema: "sgc" } },
  );

  const { data: tokens } = await supabase
    .from("device_tokens")
    .select("token, plataforma")
    .in("usuario_id", user_ids)
    .eq("activo", true);

  if (!tokens || tokens.length === 0) {
    return json({ skipped: true, reason: "Sin device tokens activos." });
  }

  const saRaw = Deno.env.get("FCM_SERVICE_ACCOUNT_JSON");
  if (!saRaw) {
    // Credenciales FCM pendientes de Xaviel — el in-app ya cubre la entrega.
    return json({ skipped: true, reason: "FCM no configurado (FCM_SERVICE_ACCOUNT_JSON).", tokens: tokens.length });
  }

  let sa: { client_email: string; private_key: string; project_id: string };
  try {
    sa = JSON.parse(saRaw);
  } catch {
    return json({ error: "FCM_SERVICE_ACCOUNT_JSON inválido." }, 500);
  }

  let accessToken: string;
  try {
    accessToken = await getAccessToken(sa);
  } catch (e) {
    return json({ error: `OAuth FCM falló: ${e instanceof Error ? e.message : e}` }, 500);
  }

  const endpoint = `https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`;
  const dataStr: Record<string, string> = {};
  for (const [k, v] of Object.entries(data ?? {})) dataStr[k] = v == null ? "" : String(v);

  // AL6 — canal de Android dedicado para alarmas de alta prioridad (despertador).
  // Si el payload trae data.channel_id (p. ej. 'alarma_inspeccion') o data.alarma,
  // se adjunta a android.notification para que suene como alarma en Android 8+.
  const channelId = dataStr["channel_id"] || (dataStr["alarma"] === "true" ? "alarma_inspeccion" : "");
  const esAlarma = channelId === "alarma_inspeccion" || dataStr["alarma"] === "true";

  let sent = 0, failed = 0;
  const dead: string[] = [];
  for (const t of tokens) {
    const androidNotification = channelId
      ? {
          channel_id: channelId,
          notification_priority: "PRIORITY_MAX",
          ...(esAlarma ? { default_sound: true, visibility: "PUBLIC" } : {}),
        }
      : undefined;
    // AL6-fix — la ALARMA dominical va DATA-ONLY (sin `notification`): así la app
    // (CsdMessagingService) la recibe en background y dispara la alarma full-screen
    // NATIVA (despertador) aunque esté cerrada. Con `notification` el sistema la
    // pintaría él mismo y NO llamaría al servicio en background. El título/cuerpo
    // viajan en `data` para que la alarma nativa muestre la placa. El resto de
    // pushes conservan `notification` (las pinta el sistema, sin abrir la app).
    const dataPayload = esAlarma
      ? { ...dataStr, titulo: titulo ?? "", cuerpo: cuerpo ?? "" }
      : dataStr;
    const message = {
      message: {
        token: t.token,
        ...(esAlarma ? {} : { notification: { title: titulo ?? "SGC", body: cuerpo ?? "" } }),
        data: dataPayload,
        android: {
          priority: "high",
          ...(!esAlarma && androidNotification ? { notification: androidNotification } : {}),
        },
      },
    };
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(message),
    });
    if (res.ok) { sent++; }
    else {
      failed++;
      if (res.status === 404 || res.status === 400) dead.push(t.token); // token inválido/expirado
    }
  }

  // Limpia tokens muertos.
  if (dead.length) {
    await supabase.from("device_tokens").update({ activo: false }).in("token", dead);
  }

  return json({ ok: true, sent, failed, cleaned: dead.length });
});
