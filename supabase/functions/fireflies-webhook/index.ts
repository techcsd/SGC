import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// ============================================================================
// CP8 — Recibe el webhook de Fireflies ("Transcription completed") cuando
// `minutas@constructorasd.com` graba una reunión, trae el resumen/acuerdos por
// su API GraphQL, y crea el BORRADOR del acta en sgc.reuniones/reunion_actas.
//
// Seguridad (docs/REUNIONES.md): Fireflies firma con HMAC-SHA256 en el header
// `x-hub-signature` (`sha256=<hex>`) SOLO si se configuró un secreto al crear
// el webhook. Sin firma válida, se RECHAZA (fail-closed) — nunca se procesa a
// ciegas. Service role: este endpoint no tiene sesión de usuario (lo llama
// Fireflies), así que escribe con permisos de servidor.
//
// Requiere (si faltan, el endpoint responde 503 — no hay forma de operar sin
// ellos, a diferencia de Calendar que sí tiene un modo "no conectado"):
//   FIREFLIES_WEBHOOK_SECRET — el mismo que se configuró en Fireflies al crear el webhook V2.
//   FIREFLIES_API_KEY        — de la cuenta minutas@ (Developer Settings).
//
// Límite confirmado (ver docs/REUNIONES.md): el webhook solo dispara para el
// DUEÑO/organizador en Fireflies. Las reuniones programadas desde el SGC usan
// minutas@ como organizadora (garantiza el disparo); las externas donde alguien
// más organiza pueden no llegar aquí — el respaldo es el cron de polling
// (pendiente, FASE siguiente) que lista transcripciones recientes de la API.
// ============================================================================

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const FIREFLIES_WEBHOOK_SECRET = Deno.env.get("FIREFLIES_WEBHOOK_SECRET");
const FIREFLIES_API_KEY = Deno.env.get("FIREFLIES_API_KEY");

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

async function verificarFirma(rawBody: string, header: string | null): Promise<boolean> {
  if (!header || !FIREFLIES_WEBHOOK_SECRET) return false;
  const esperado = header.replace(/^sha256=/, "");
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(FIREFLIES_WEBHOOK_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sigBuf = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const calculado = [...new Uint8Array(sigBuf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  // Comparación en tiempo constante.
  if (calculado.length !== esperado.length) return false;
  let diff = 0;
  for (let i = 0; i < calculado.length; i++) diff |= calculado.charCodeAt(i) ^ esperado.charCodeAt(i);
  return diff === 0;
}

// deno-lint-ignore no-explicit-any
type Any = any;

// GraphQL de Fireflies — campos a confirmar/ajustar contra el schema real una
// vez haya API key (docs.fireflies.ai/graphql-api/query/transcript). Forma
// razonable según su documentación pública al 16-oct-2026.
async function traerTranscripcion(meetingId: string): Promise<Any> {
  const query = `query Transcript($id: String!) {
    transcript(id: $id) {
      id title duration meeting_link calendar_id
      summary { overview bullet_gist action_items keywords }
      participants
      sentences { text speaker_name }
    }
  }`;
  const res = await fetch("https://api.fireflies.ai/graphql", {
    method: "POST",
    headers: { Authorization: `Bearer ${FIREFLIES_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ query, variables: { id: meetingId } }),
  });
  const j = await res.json();
  if (!res.ok || j.errors) throw new Error(`Fireflies API: ${JSON.stringify(j).slice(0, 400)}`);
  return j.data?.transcript;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);
  if (!FIREFLIES_WEBHOOK_SECRET || !FIREFLIES_API_KEY) {
    return json({ error: "fireflies-webhook no está configurado (faltan secretos)." }, 503);
  }

  const rawBody = await req.text();
  const firmaOk = await verificarFirma(rawBody, req.headers.get("x-hub-signature"));
  if (!firmaOk) return json({ error: "Firma inválida" }, 401);

  let payload: { meetingId?: string; eventType?: string };
  try { payload = JSON.parse(rawBody); } catch { return json({ error: "Body inválido" }, 400); }
  if (payload.eventType && !/transcription completed/i.test(payload.eventType)) {
    return json({ ignorado: true, motivo: `eventType '${payload.eventType}' no procesado` });
  }
  if (!payload.meetingId) return json({ error: "Falta meetingId" }, 400);

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { db: { schema: "sgc" }, auth: { persistSession: false } });

  let transcript: Any;
  try { transcript = await traerTranscripcion(payload.meetingId); }
  catch (e) { return json({ error: e instanceof Error ? e.message : "No se pudo leer la transcripción" }, 502); }
  if (!transcript) return json({ error: "Fireflies no devolvió la transcripción" }, 502);

  // 1) ¿ya hay una reunión ligada a este fireflies_id? (reintento del webhook)
  let { data: reunion } = await admin.from("reuniones").select("id").eq("fireflies_id", payload.meetingId).maybeSingle();

  // 2) si no, intenta por enlace de Meet (reunión programada desde el SGC con minutas@).
  if (!reunion && transcript.meeting_link) {
    const { data } = await admin.from("reuniones").select("id").eq("enlace", transcript.meeting_link).is("fireflies_id", null).maybeSingle();
    reunion = data ?? null;
  }

  let reunionId: string;
  if (reunion) {
    reunionId = reunion.id;
    await admin.from("reuniones").update({ fireflies_id: payload.meetingId, estado: "acta_borrador", updated_at: new Date().toISOString() }).eq("id", reunionId);
  } else {
    // "Reunión sin ligar" — alguien la liga a una obra/tipo después desde la web.
    const { data: tipoOtra } = await admin.from("reunion_tipos").select("id").eq("codigo", "otra").single();
    const { data: nueva, error } = await admin.from("reuniones").insert({
      tipo_id: tipoOtra!.id,
      titulo: transcript.title ?? "Reunión (Fireflies, sin ligar)",
      inicio: new Date().toISOString(),
      fin: null,
      modalidad: "meet",
      enlace: transcript.meeting_link ?? null,
      organizador_id: null, // sin dueño SGC claro — la ficha lo pedirá al ligar
      estado: "acta_borrador",
      fireflies_id: payload.meetingId,
      sin_ligar: true,
    }).select("id").single();
    if (error || !nueva) return json({ error: `No se pudo crear la reunión sin ligar: ${error?.message}` }, 500);
    reunionId = nueva.id;
  }

  const resumen = [
    transcript.summary?.overview,
    transcript.summary?.bullet_gist ? `\nPuntos:\n- ${(Array.isArray(transcript.summary.bullet_gist) ? transcript.summary.bullet_gist : [transcript.summary.bullet_gist]).join("\n- ")}` : "",
  ].filter(Boolean).join("\n");

  await admin.from("reunion_actas").upsert({
    reunion_id: reunionId, resumen, creado_por_tipo: "fireflies", fireflies_raw: transcript,
  }, { onConflict: "reunion_id" });

  // Acuerdos sugeridos (action_items) — se crean como borrador SIN responsable
  // (el organizador los asigna al revisar el acta; no hay forma confiable de
  // mapear "action item" de texto libre a un usuario del SGC sin intervención).
  const items: string[] = Array.isArray(transcript.summary?.action_items) ? transcript.summary.action_items : [];
  for (const texto of items.slice(0, 20)) {
    await admin.from("reunion_acuerdos").insert({ reunion_id: reunionId, texto: String(texto).slice(0, 500) });
  }

  return json({ ok: true, reunion_id: reunionId, acuerdos_sugeridos: items.length });
});
