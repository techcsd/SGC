import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// ============================================================================
// CP8 — Reuniones: crear/actualizar/cancelar el evento de Google Calendar (con
// Meet) de una reunión del SGC, desde la cuenta `minutas@constructorasd.com`
// como ORGANIZADORA (decisión confirmada en docs/REUNIONES.md: Fireflies solo
// dispara su webhook de forma confiable para el DUEÑO de la reunión — por eso
// minutas@ organiza, nunca solo invitada).
//
// Requiere, en secretos del edge (si faltan, responde {conectado:false} y el
// resto del módulo sigue funcionando sin Calendar — "Calendar no conectado"):
//   GOOGLE_SERVICE_ACCOUNT_JSON  — JSON completo de la cuenta de servicio (con
//                                  delegación de dominio ya ampliada a
//                                  calendar.events en Google Admin).
//   GOOGLE_CALENDAR_DELEGATED_USER — minutas@constructorasd.com
//
// Corre con el JWT del usuario (RLS aplica a la lectura/escritura de la
// reunión); el único service-role real aquí es el de Google (JWT bearer propio
// de la cuenta de servicio), no el de Supabase.
// ============================================================================

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SA_JSON = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_JSON");
const DELEGATED_USER = Deno.env.get("GOOGLE_CALENDAR_DELEGATED_USER");

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
  let s = btoa(String.fromCharCode(...b));
  return s.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const clean = pem.replace(/-----BEGIN PRIVATE KEY-----/, "").replace(/-----END PRIVATE KEY-----/, "").replace(/\s+/g, "");
  const bin = atob(clean);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}

// Flujo estándar de "service account JWT bearer" de Google, con subject
// delegado (domain-wide delegation) para actuar como minutas@.
async function googleAccessToken(): Promise<string> {
  const sa = JSON.parse(SA_JSON!);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const now = Math.floor(Date.now() / 1000);
  const claims = base64url(JSON.stringify({
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/calendar.events",
    aud: "https://oauth2.googleapis.com/token",
    sub: DELEGATED_USER,
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
  if (!res.ok || !tok.access_token) throw new Error(`Google token: ${JSON.stringify(tok).slice(0, 300)}`);
  return tok.access_token;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "No autorizado" }, 401);
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { db: { schema: "sgc" }, global: { headers: { Authorization: authHeader } } });
  const { data: userData } = await supabase.auth.getUser();
  if (!userData?.user) return json({ error: "Sesión inválida" }, 401);

  let payload: { accion?: "crear" | "actualizar" | "cancelar"; reunion_id?: string };
  try { payload = await req.json(); } catch { return json({ error: "Body inválido" }, 400); }
  const reunionId = payload.reunion_id;
  if (!reunionId) return json({ error: "Falta reunion_id" }, 400);

  if (!SA_JSON || !DELEGATED_USER) {
    const mensaje = "Calendar no conectado. Copia la invitación y mándala tú — avísale a Tecnología que falta configurar Google Calendar.";
    await supabase.from("reuniones").update({
      calendar_sync_estado: "no_conectado", calendar_sync_error: mensaje, calendar_sync_at: new Date().toISOString(),
    }).eq("id", reunionId);
    return json({ conectado: false, mensaje, motivo: "no_configurado" });
  }

  // Trae la reunión + participantes CON el JWT del usuario (RLS: solo si puede verla).
  const { data: reunion, error: rErr } = await supabase.from("reuniones")
    .select("id, titulo, inicio, fin, modalidad, lugar, google_event_id, estado").eq("id", reunionId).maybeSingle();
  if (rErr || !reunion) return json({ error: "No se encontró la reunión o no tienes acceso." }, 404);

  const { data: participantes } = await supabase.from("reunion_participantes")
    .select("usuario_id, correo_externo, usuarios:usuario_id(email, nombre)").eq("reunion_id", reunionId);
  const correos = new Set<string>([DELEGATED_USER]);
  for (const p of (participantes ?? []) as Any[]) {
    const email = p.usuarios?.email ?? p.correo_externo;
    if (email) correos.add(email);
  }

  try {
    const accessToken = await googleAccessToken();

    if (payload.accion === "cancelar") {
      if (reunion.google_event_id) {
        await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(DELEGATED_USER)}/events/${reunion.google_event_id}`, {
          method: "DELETE", headers: { Authorization: `Bearer ${accessToken}` },
        });
      }
      await supabase.from("reuniones").update({
        calendar_sync_estado: "sincronizado", calendar_sync_error: null, calendar_sync_at: new Date().toISOString(),
      }).eq("id", reunionId);
      return json({ conectado: true, cancelado: true });
    }

    const body = {
      summary: reunion.titulo,
      location: reunion.lugar ?? undefined,
      start: { dateTime: reunion.inicio, timeZone: "America/Santo_Domingo" },
      end: { dateTime: reunion.fin ?? reunion.inicio, timeZone: "America/Santo_Domingo" },
      attendees: [...correos].map((email) => ({ email })),
      conferenceData: reunion.modalidad === "presencial" ? undefined : {
        createRequest: { requestId: `sgc-${reunionId}`, conferenceSolutionKey: { type: "hangoutsMeet" } },
      },
    };
    const method = reunion.google_event_id ? "PATCH" : "POST";
    const url = reunion.google_event_id
      ? `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(DELEGATED_USER)}/events/${reunion.google_event_id}?conferenceDataVersion=1&sendUpdates=all`
      : `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(DELEGATED_USER)}/events?conferenceDataVersion=1&sendUpdates=all`;
    const evRes = await fetch(url, {
      method, headers: { Authorization: `Bearer ${accessToken}`, "content-type": "application/json" }, body: JSON.stringify(body),
    });
    const ev = await evRes.json();
    if (!evRes.ok) {
      const motivo = ev.error?.message ?? "error";
      await supabase.from("reuniones").update({
        calendar_sync_estado: "error", calendar_sync_error: motivo, calendar_sync_at: new Date().toISOString(),
      }).eq("id", reunionId);
      return json({ conectado: false, error: `No se pudo crear el evento: ${motivo}` }, 502);
    }

    const enlace = ev.hangoutLink ?? ev.conferenceData?.entryPoints?.find((e: Any) => e.entryPointType === "video")?.uri ?? null;
    await supabase.from("reuniones").update({
      google_event_id: ev.id, enlace, updated_at: new Date().toISOString(),
      calendar_sync_estado: "sincronizado", calendar_sync_error: null, calendar_sync_at: new Date().toISOString(),
    }).eq("id", reunionId);

    return json({ conectado: true, google_event_id: ev.id, enlace });
  } catch (e) {
    const motivo = e instanceof Error ? e.message : "error";
    await supabase.from("reuniones").update({
      calendar_sync_estado: "error", calendar_sync_error: motivo, calendar_sync_at: new Date().toISOString(),
    }).eq("id", reunionId);
    return json({ conectado: false, error: `No se pudo conectar con Google Calendar: ${motivo}` }, 502);
  }
});
