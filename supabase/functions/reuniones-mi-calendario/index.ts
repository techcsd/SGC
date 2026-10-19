import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// ============================================================================
// CS10 — "Mi calendario de Google" (lectura) en Reuniones. Hermano de
// `reuniones-calendar` (que SOLO escribe, como minutas@) — este SOLO lee, y
// SIEMPRE el calendario de quien llama (nunca uno ajeno): token con scope
// `calendar.readonly` y `sub` = el correo del usuario autenticado, nunca un
// correo que llegue en el body. Dos tokens de Google distintos a propósito
// (lectura vs. escritura), nunca uno con ambos scopes.
//
// Requiere los MISMOS secretos que `reuniones-calendar` (si faltan, responde
// {conectado:false, motivo:'no_configurado'} y la pantalla lo explica):
//   GOOGLE_SERVICE_ACCOUNT_JSON — misma cuenta de servicio.
// (GOOGLE_CALENDAR_DELEGATED_USER NO se usa aquí — cada quien es su propio
// delegado: domain-wide delegation permite `sub` = cualquier correo del dominio.)
//
// 19-oct-2026: ni dev ni prod tienen hoy GOOGLE_SERVICE_ACCOUNT_JSON configurado
// (verificado por Management API, sin imprimir valores) — este edge queda
// LISTO y responde {conectado:false} en ambos entornos hasta que exista la
// cuenta de servicio real (ver docs/REUNIONES.md).
// ============================================================================

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SA_JSON = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_JSON");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-sgc-client",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

// deno-lint-ignore no-explicit-any
type Any = any;

function base64url(bytes: Uint8Array | string): string {
  const b = typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
  const s = btoa(String.fromCharCode(...b));
  return s.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function pemToArrayBuffer(pem: string): ArrayBuffer {
  const clean = pem.replace(/-----BEGIN PRIVATE KEY-----/, "").replace(/-----END PRIVATE KEY-----/, "").replace(/\s+/g, "");
  const bin = atob(clean);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}
// Mismo flujo "service account JWT bearer" que reuniones-calendar, pero con
// `sub` = el correo de QUIEN CONSULTA (nunca un correo fijo) y scope SOLO lectura.
async function googleReadOnlyToken(subject: string): Promise<string> {
  const sa = JSON.parse(SA_JSON!);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const now = Math.floor(Date.now() / 1000);
  const claims = base64url(JSON.stringify({
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/calendar.readonly",
    aud: "https://oauth2.googleapis.com/token",
    sub: subject,
    iat: now, exp: now + 3600,
  }));
  const signingInput = `${header}.${claims}`;
  const key = await crypto.subtle.importKey(
    "pkcs8", pemToArrayBuffer(sa.private_key), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(signingInput));
  const jwt = `${signingInput}.${base64url(new Uint8Array(sig))}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: `grant_type=${encodeURIComponent("urn:ietf:params:oauth:grant-type:jwt-bearer")}&assertion=${jwt}`,
  });
  const tok = await res.json();
  if (!res.ok || !tok.access_token) {
    const detalle = JSON.stringify(tok).slice(0, 300);
    throw new Error(`google_token:${detalle}`);
  }
  return tok.access_token;
}

const DOMINIO_SINTETICO = /@(personal|conductores|test)\.constructorasd\.local$/i;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "No autorizado" }, 401);
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { db: { schema: "sgc" }, global: { headers: { Authorization: authHeader } } });

  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData?.user?.email) return json({ error: "Sesión inválida" }, 401);
  const correo = userData.user.email;

  // CS10/CS6 — rechaza tokens OAuth de Claude: el guard falla SOLO con 42501
  // (cualquier otro error se registra y responde 500 con el motivo real).
  const { error: oauthErr } = await supabase.rpc("rechazar_si_cliente_oauth");
  if (oauthErr) {
    if (oauthErr.code === "42501") {
      return json({ error: "Esta acción no está permitida desde un conector externo (Claude)." }, 403);
    }
    console.error("rechazar_si_cliente_oauth falló (no es Claude):", oauthErr);
    return json({ error: `No se pudo verificar el origen de la sesión: ${oauthErr.message}` }, 500);
  }

  if (!SA_JSON) {
    return json({ conectado: false, motivo: "no_configurado", mensaje: "Calendar no conectado. Avísale a Tecnología." });
  }
  if (DOMINIO_SINTETICO.test(correo)) {
    return json({ conectado: false, motivo: "sin_cuenta_google", mensaje: "Tu cuenta no tiene calendario de Google conectado." });
  }

  const ahora = Date.now();
  const timeMin = new Date(ahora - 7 * 86_400_000).toISOString();
  const timeMax = new Date(ahora + 60 * 86_400_000).toISOString();

  try {
    const accessToken = await googleReadOnlyToken(correo);
    const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(correo)}/events`);
    url.searchParams.set("timeMin", timeMin);
    url.searchParams.set("timeMax", timeMax);
    url.searchParams.set("singleEvents", "true");
    url.searchParams.set("orderBy", "startTime");
    url.searchParams.set("maxResults", "250");

    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    const data = await res.json();
    if (!res.ok) {
      return json({ conectado: false, motivo: "error_google", mensaje: "No se pudo actualizar tu calendario de Google." }, 200);
    }

    const eventos = ((data.items ?? []) as Any[]).map((ev) => {
      const privado = ev.visibility === "private" || ev.visibility === "confidential";
      const enlace = ev.hangoutLink ?? ev.conferenceData?.entryPoints?.find((e: Any) => e.entryPointType === "video")?.uri ?? null;
      return {
        id: ev.id,
        titulo: privado ? "Ocupado" : (ev.summary ?? "(sin título)"),
        inicio: ev.start?.dateTime ?? ev.start?.date ?? null,
        fin: ev.end?.dateTime ?? ev.end?.date ?? null,
        lugar: privado ? null : (ev.location ?? null),
        enlace_meet: privado ? null : enlace,
        organizador: privado ? null : (ev.organizer?.email ?? null),
        participantes: privado ? null : (ev.attendees?.length ?? 0),
        privado,
      };
    });

    // Auditoría: "consultó su calendario", nunca el contenido.
    await supabase.from("audit_log").insert({
      actor_id: userData.user.id, action: "reuniones_consulto_calendario_google",
      metadata: { cantidad: eventos.length },
    }).then(() => {}, () => {});

    return json({ conectado: true, eventos, actualizado_en: new Date().toISOString() });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    // invalid_grant/unauthorized_client = esta cuenta no tiene el scope/no es
    // delegable (dominio distinto, cuenta sin licencia, etc.) — no es un fallo
    // transitorio de red, es "no conectado" para esta persona en particular.
    if (/invalid_grant|unauthorized_client/i.test(msg)) {
      return json({ conectado: false, motivo: "sin_cuenta_google", mensaje: "Tu cuenta no tiene calendario de Google conectado." });
    }
    console.error("reuniones-mi-calendario:", msg);
    return json({ conectado: false, motivo: "error_google", mensaje: "No se pudo actualizar tu calendario de Google." });
  }
});
