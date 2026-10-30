import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { envRequerido } from "../_shared/env.ts";
import {
  normalizarTelefono, verificarFirmaMeta, marcarLeidoYEscribiendo,
  enviarTextoWhatsapp, enviarRespuestaLarga, obtenerUrlMedia, descargarMedia,
  type GraphConfig,
} from "../_shared/whatsapp.ts";
import { resolverSttConfig, transcribirAudio } from "../_shared/stt.ts";

// ============================================================================
// DC3 (ronda DC, rebautizada de DA por colisión de letra de ronda — ver
// HANDOFF) — Puente OFICIAL de WhatsApp Cloud API (Meta) para Compa.
// Reemplaza el puente n8n + Evolution API (NO oficial, bloqueado por Meta —
// ver skill `ws-ops`, stack ahora retirado de este flujo). Este webhook:
//   1. Verifica el handshake GET de Meta (hub.challenge).
//   2. Recibe el POST de Meta, valida la firma HMAC (X-Hub-Signature-256).
//   3. Responde 200 YA (EdgeRuntime.waitUntil) y procesa en segundo plano.
//   4. Resuelve el remitente contra sgc.whatsapp_autorizados (BJ2, sin
//      cambios) y llama a la edge `assistant` en modo WhatsApp (x-wa-secret,
//      el mismo contrato que ya existía — este webhook es el ÚNICO cambio).
//   5. Responde por Graph API, convirtiendo markdown → texto de WhatsApp y
//      partiendo en chunks.
//
// verify_jwt = false (supabase/config.toml): lo llama Meta, server-to-server;
// la autenticación real es la firma HMAC, no un JWT de Supabase.
// ============================================================================

const WHATSAPP_TOKEN = Deno.env.get("WHATSAPP_TOKEN");
const WHATSAPP_PHONE_NUMBER_ID = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");
const WHATSAPP_APP_SECRET = Deno.env.get("WHATSAPP_APP_SECRET");
const WHATSAPP_VERIFY_TOKEN = Deno.env.get("WHATSAPP_VERIFY_TOKEN");
// DC1 — versión estable de Graph API al momento de esta ronda (jul-2026).
// Secreto para poder subirla sin redeploy cuando Meta publique la siguiente.
const WHATSAPP_GRAPH_VERSION = Deno.env.get("WHATSAPP_GRAPH_VERSION") ?? "v26.0";
// BJ2 — mismo secreto compartido que ya usa `assistant` (DC1: el código
// siempre leyó WHATSAPP_ASSISTANT_SECRET; docs/ENTORNOS.md tenía el nombre
// desalineado — WHATSAPP_ASSISTANT_SYNC_SECRET — y se corrigió ahí, no aquí).
const WHATSAPP_ASSISTANT_SECRET = Deno.env.get("WHATSAPP_ASSISTANT_SECRET");

const SUPABASE_URL = envRequerido("SUPABASE_URL");
const SUPABASE_ANON_KEY = envRequerido("SUPABASE_ANON_KEY");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const SECRETS_REQUERIDOS: Record<string, string | undefined> = {
  WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_APP_SECRET,
  WHATSAPP_VERIFY_TOKEN, WHATSAPP_ASSISTANT_SECRET,
};

// deno-lint-ignore no-explicit-any
type Any = any;

function admin() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { db: { schema: "sgc" }, auth: { persistSession: false } });
}

function graphCfg(): GraphConfig {
  return { token: WHATSAPP_TOKEN!, phoneNumberId: WHATSAPP_PHONE_NUMBER_ID!, graphVersion: WHATSAPP_GRAPH_VERSION };
}

// ── Registro en sgc.whatsapp_mensajes (best-effort: nunca tumba el flujo) ──
// `salida` siempre es un INSERT (cada chunk de salida tiene su propio
// wa_message_id de Graph, o ninguno si el envío falló). `entrada` es siempre
// un UPDATE sobre la fila-claim que `procesarValue` ya insertó para el dedupe
// (mismo wa_message_id, unique) — insertar de nuevo violaría esa unicidad y
// fallaría en silencio (fue exactamente el bug que atrapó el smoke DC9).
async function registrarMensaje(sb: Any, fila: Record<string, Any>) {
  await sb.from("whatsapp_mensajes").insert(fila).then(() => {}, () => {});
}

async function actualizarMensajeEntrada(sb: Any, waMessageId: string, cambios: Record<string, Any>) {
  await sb.from("whatsapp_mensajes").update(cambios).eq("wa_message_id", waMessageId).then(() => {}, () => {});
}

// ── Estado por teléfono (conversación vigente, avisos) ─────────────────────
async function estadoConversacion(sb: Any, telefono: string) {
  const { data } = await sb.from("whatsapp_conversaciones").select("*").eq("telefono", telefono).maybeSingle();
  return data as Any | null;
}

async function upsertConversacion(sb: Any, telefono: string, cambios: Record<string, Any>) {
  await sb.from("whatsapp_conversaciones").upsert({ telefono, ...cambios }, { onConflict: "telefono" }).then(() => {}, () => {});
}

// ── Llama a `assistant` en modo WhatsApp (mismo contrato BJ2, + conversacion_id DC5) ──
async function llamarCompa(telefono: string, mensaje: string, conversacionId: string | null): Promise<Any> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90_000);
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/assistant`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-wa-secret": WHATSAPP_ASSISTANT_SECRET! },
      body: JSON.stringify({ telefono, mensaje, conversacion_id: conversacionId }),
      signal: controller.signal,
    });
    const j = await res.json().catch(() => null);
    if (!res.ok) return { error: `assistant HTTP ${res.status}`, detalle: j };
    return j;
  } finally {
    clearTimeout(timeout);
  }
}

const AVISO_PRIMER_USO = [
  "👋 Hola, soy *Compa*, el asistente de SGC. Te respondo con los MISMOS permisos que tienes en el sistema — nada más, nada menos.",
  "Tus mensajes se procesan por WhatsApp (Meta) y por Anthropic (la inteligencia artificial que genera la respuesta).",
  "Política de privacidad: https://sgcconstructorasd.com/politicas/privacidad",
  "",
].join("\n");

const MENSAJE_NO_AUTORIZADO =
  "Hola 👋 Este número no está autorizado para consultar a Compa por aquí. Si crees que es un error, escríbele a Tecnología.";

// ── Procesamiento de UN mensaje entrante (ya deduplicado) ──────────────────
async function procesarMensajeEntrante(sb: Any, cfg: GraphConfig, msg: Any, metadata: Any) {
  const telefonoCrudo = String(msg.from ?? "");
  const telefono = normalizarTelefono(telefonoCrudo);
  const waMessageId = String(msg.id ?? "");
  const tipo = String(msg.type ?? "otro");

  await marcarLeidoYEscribiendo(cfg, waMessageId);

  // Resuelve contra la lista blanca (BJ2, sin cambios) ANTES de gastar nada.
  const { data: resolved } = await sb.rpc("whatsapp_resolver", { p_telefono: telefono });
  const row = Array.isArray(resolved) ? resolved[0] : resolved;

  if (!row?.email) {
    const estado = await estadoConversacion(sb, telefono);
    const ultimoAviso = estado?.ultimo_aviso_no_autorizado_en ? new Date(estado.ultimo_aviso_no_autorizado_en) : null;
    const yaAvisado24h = ultimoAviso && (Date.now() - ultimoAviso.getTime()) < 24 * 60 * 60 * 1000;
    // El `tipo` de Meta llega en inglés ('text','audio',…); la columna solo
    // acepta el enum en español (CHECK) — para no_autorizado no nos interesa
    // distinguir el tipo, así que se guarda como 'otro'.
    await actualizarMensajeEntrada(sb, waMessageId, { telefono, tipo: "otro", estado: "no_autorizado" });
    if (!yaAvisado24h) {
      const r = await enviarTextoWhatsapp(cfg, telefonoCrudo, MENSAJE_NO_AUTORIZADO, { contextoMessageId: waMessageId });
      await registrarMensaje(sb, { wa_message_id: r.waMessageId, direccion: "salida", telefono, tipo: "texto", estado: r.ok ? "entregado" : "fallido", texto: MENSAJE_NO_AUTORIZADO, error: r.error ?? null });
      await upsertConversacion(sb, telefono, { ultimo_aviso_no_autorizado_en: new Date().toISOString() });
    }
    return;
  }

  // ── Tipos no soportados en v1: imagen/documento/video/sticker/location/otro ──
  if (tipo !== "text" && tipo !== "audio" && tipo !== "interactive" && tipo !== "button") {
    const texto = "Por ahora solo puedo leer mensajes de *texto* y *notas de voz* 🙏. Mándame tu pregunta escrita o por audio.";
    await actualizarMensajeEntrada(sb, waMessageId, { telefono, usuario_id: row.usuario_id, tipo: "otro", estado: "ignorado" });
    const r = await enviarTextoWhatsapp(cfg, telefonoCrudo, texto, { contextoMessageId: waMessageId });
    await registrarMensaje(sb, { wa_message_id: r.waMessageId, direccion: "salida", telefono, usuario_id: row.usuario_id, tipo: "texto", estado: r.ok ? "entregado" : "fallido", texto, error: r.error ?? null });
    return;
  }

  // ── Extrae el texto del mensaje según el tipo ──────────────────────────
  let textoEntrante = "";
  let duracionMs: number | null = null;
  if (tipo === "text") {
    textoEntrante = String(msg.text?.body ?? "").trim();
  } else if (tipo === "interactive") {
    textoEntrante = String(msg.interactive?.button_reply?.title ?? msg.interactive?.list_reply?.title ?? "").trim();
  } else if (tipo === "button") {
    textoEntrante = String(msg.button?.text ?? "").trim();
  } else if (tipo === "audio") {
    const sttCfg = resolverSttConfig();
    if (!sttCfg) {
      const texto = "Por ahora no puedo escuchar notas de voz, escríbeme el mensaje 🙏";
      await actualizarMensajeEntrada(sb, waMessageId, { telefono, usuario_id: row.usuario_id, tipo: "audio", estado: "ignorado" });
      const r = await enviarTextoWhatsapp(cfg, telefonoCrudo, texto, { contextoMessageId: waMessageId });
      await registrarMensaje(sb, { wa_message_id: r.waMessageId, direccion: "salida", telefono, usuario_id: row.usuario_id, tipo: "texto", estado: r.ok ? "entregado" : "fallido", texto, error: r.error ?? null });
      return;
    }
    try {
      const t0 = Date.now();
      const media = await obtenerUrlMedia(cfg, String(msg.audio?.id ?? ""));
      const blob = await descargarMedia(cfg, media.url);
      const ext = media.mimeType.includes("ogg") ? "ogg" : media.mimeType.includes("mp4") ? "mp4" : "ogg";
      textoEntrante = await transcribirAudio(blob, ext, sttCfg);
      duracionMs = Date.now() - t0;
      // DC4 — el audio NUNCA se guarda, solo su transcripción.
    } catch (e) {
      const texto = "No pude escuchar tu nota de voz esta vez — ¿me la escribes?";
      await actualizarMensajeEntrada(sb, waMessageId, { telefono, usuario_id: row.usuario_id, tipo: "audio", estado: "error", error: String(e instanceof Error ? e.message : e).slice(0, 400) });
      const r = await enviarTextoWhatsapp(cfg, telefonoCrudo, texto, { contextoMessageId: waMessageId });
      await registrarMensaje(sb, { wa_message_id: r.waMessageId, direccion: "salida", telefono, usuario_id: row.usuario_id, tipo: "texto", estado: r.ok ? "entregado" : "fallido", texto, error: r.error ?? null });
      return;
    }
  }

  if (!textoEntrante) {
    // Mismo motivo que el bloque no_autorizado: `tipo` crudo de Meta no es un
    // valor válido del CHECK de la columna (que es el enum en español).
    await actualizarMensajeEntrada(sb, waMessageId, { telefono, usuario_id: row.usuario_id, tipo: "otro", estado: "ignorado" });
    return;
  }

  await actualizarMensajeEntrada(sb, waMessageId, {
    telefono, usuario_id: row.usuario_id,
    tipo: tipo === "audio" ? "audio" : "texto", texto: textoEntrante, duracion_ms: duracionMs, estado: "recibido",
  });

  // ── DC5 — conversación vigente: se reusa si el último mensaje fue hace
  //    menos de 30 min. Si el texto pide reiniciar ("nuevo"/"reiniciar"/
  //    "/nuevo"), es `assistant` (DC5) quien lo detecta y responde con la
  //    confirmación — este puente no duplica esa lógica, solo decide la
  //    ventana de 30 min.
  const estado = await estadoConversacion(sb, telefono);
  const vigente = estado?.ultimo_mensaje_en && (Date.now() - new Date(estado.ultimo_mensaje_en).getTime()) < 30 * 60 * 1000;
  let conversacionId: string | null = vigente ? (estado?.conversacion_id ?? null) : null;

  // ── DC6 — aviso de primer uso (privacidad), ANTES de la respuesta de Compa.
  const esPrimerUso = !estado?.aviso_primer_uso_en;
  if (esPrimerUso) {
    const r = await enviarTextoWhatsapp(cfg, telefonoCrudo, AVISO_PRIMER_USO);
    await registrarMensaje(sb, { wa_message_id: r.waMessageId, direccion: "salida", telefono, usuario_id: row.usuario_id, tipo: "texto", estado: r.ok ? "entregado" : "fallido", texto: AVISO_PRIMER_USO, error: r.error ?? null });
    await upsertConversacion(sb, telefono, { usuario_id: row.usuario_id, aviso_primer_uso_en: new Date().toISOString() });
  }

  // ── Llama a Compa ───────────────────────────────────────────────────────
  let respuesta: Any;
  try {
    respuesta = await llamarCompa(telefono, textoEntrante, conversacionId);
  } catch (e) {
    const texto = "Compa tuvo un problema para responderte. Inténtalo de nuevo en un momento 🙏";
    await registrarMensaje(sb, { wa_message_id: null, direccion: "salida", telefono, usuario_id: row.usuario_id, tipo: "texto", estado: "error", texto, error: String(e instanceof Error ? e.message : e).slice(0, 400) });
    const r = await enviarTextoWhatsapp(cfg, telefonoCrudo, texto, { contextoMessageId: waMessageId });
    await registrarMensaje(sb, { wa_message_id: r.waMessageId, direccion: "salida", telefono, usuario_id: row.usuario_id, tipo: "texto", estado: r.ok ? "entregado" : "fallido", texto, error: r.error ?? null });
    return;
  }

  if (respuesta?.error && !respuesta?.respuesta && !respuesta?.reply) {
    const texto = "Compa tuvo un problema para responderte. Inténtalo de nuevo en un momento 🙏";
    await registrarMensaje(sb, { wa_message_id: null, direccion: "salida", telefono, usuario_id: row.usuario_id, tipo: "texto", estado: "error", texto, error: String(respuesta.error).slice(0, 400) });
    const r = await enviarTextoWhatsapp(cfg, telefonoCrudo, texto, { contextoMessageId: waMessageId });
    await registrarMensaje(sb, { wa_message_id: r.waMessageId, direccion: "salida", telefono, usuario_id: row.usuario_id, tipo: "texto", estado: r.ok ? "entregado" : "fallido", texto, error: r.error ?? null });
    return;
  }

  conversacionId = respuesta?.conversacion_id ?? conversacionId;
  // DC5 — la respuesta puede venir como `reply` (early-return del modo
  // WhatsApp, p. ej. "no autorizado" — ya filtrado arriba — o mensaje vacío) o
  // como `respuesta` (branch CHAT normal); los `archivos`/`propuesta` se
  // anexan como texto (v1: sin subida de media).
  let textoRespuesta = String(respuesta?.respuesta ?? respuesta?.reply ?? "").trim();
  if (!textoRespuesta) textoRespuesta = "No tengo una respuesta para eso todavía 🙏";

  const archivos: Any[] = respuesta?.archivos ?? (respuesta?.archivo ? [respuesta.archivo] : []);
  if (archivos.length) {
    textoRespuesta += "\n\n" + archivos.map((a: Any) => `📎 ${a.nombre}: ${a.url}`).join("\n");
  }

  const resultados = await enviarRespuestaLarga(cfg, telefonoCrudo, textoRespuesta, waMessageId);
  for (const r of resultados) {
    await registrarMensaje(sb, {
      wa_message_id: r.waMessageId, direccion: "salida", telefono, usuario_id: row.usuario_id,
      tipo: "texto", estado: r.ok ? "entregado" : "fallido", texto: textoRespuesta, conversacion_id: conversacionId, error: r.error ?? null,
    });
  }

  await upsertConversacion(sb, telefono, {
    usuario_id: row.usuario_id, conversacion_id: conversacionId, ultimo_mensaje_en: new Date().toISOString(),
  });
  await sb.from("whatsapp_autorizados").update({ ultimo_uso_en: new Date().toISOString() }).eq("usuario_id", row.usuario_id).then(() => {}, () => {});
}

// ── Procesa un `value` del webhook (un cambio de un número de teléfono) ────
async function procesarValue(sb: Any, cfg: GraphConfig, value: Any) {
  if (String(value?.metadata?.phone_number_id ?? "") !== WHATSAPP_PHONE_NUMBER_ID) return;

  // statuses[] — nunca se responde, solo se actualiza el registro de salida.
  for (const st of value.statuses ?? []) {
    const estadoMap: Record<string, string> = { sent: "entregado", delivered: "entregado", read: "leido", failed: "fallido" };
    const nuevoEstado = estadoMap[String(st.status)] ?? null;
    if (!nuevoEstado) continue;
    const errorDetalle = Array.isArray(st.errors) && st.errors.length ? JSON.stringify(st.errors).slice(0, 400) : null;
    await sb.from("whatsapp_mensajes").update({ estado: nuevoEstado, error: errorDetalle })
      .eq("wa_message_id", st.id).then(() => {}, () => {});
  }

  // messages[] — dedupe por wa_message_id ANTES de cualquier otro trabajo.
  for (const msg of value.messages ?? []) {
    const waMessageId = String(msg.id ?? "");
    if (!waMessageId) continue;
    const { error: dupErr } = await sb.from("whatsapp_mensajes")
      .insert({ wa_message_id: waMessageId, direccion: "entrada", telefono: normalizarTelefono(String(msg.from ?? "")), tipo: "estado", estado: "procesando" });
    if (dupErr) continue; // ya existía (on conflict do nothing vía unique + insert fallido) → ya se procesó
    try {
      await procesarMensajeEntrante(sb, cfg, msg, value.metadata);
    } catch (e) {
      console.error(`[whatsapp-webhook] error procesando ${waMessageId}:`, e);
      await sb.from("whatsapp_mensajes").update({ estado: "error", error: String(e instanceof Error ? e.message : e).slice(0, 400) })
        .eq("wa_message_id", waMessageId).eq("tipo", "estado").then(() => {}, () => {});
    }
  }
}

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);

  // ── GET ?modo=estado — DC7 (pantalla Tecnología › Compa en WhatsApp).
  //    Requiere sesión real (admin/tecnología) y SOLO devuelve booleans —
  //    nunca el valor de un secret.
  if (req.method === "GET" && url.searchParams.get("modo") === "estado") {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return new Response(JSON.stringify({ error: "No autorizado" }), { status: 401, headers: { "Content-Type": "application/json" } });
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { db: { schema: "sgc" }, global: { headers: { Authorization: authHeader } } });
    const { data: userData } = await supabase.auth.getUser();
    if (!userData?.user) return new Response(JSON.stringify({ error: "Sesión inválida" }), { status: 401, headers: { "Content-Type": "application/json" } });
    const [{ data: esAdmin }, { data: esTec }] = await Promise.all([
      supabase.rpc("is_admin"), supabase.rpc("es_tecnologia"),
    ]);
    if (!esAdmin && !esTec) return new Response(JSON.stringify({ error: "No autorizado" }), { status: 403, headers: { "Content-Type": "application/json" } });
    return new Response(JSON.stringify({
      secretos: {
        WHATSAPP_TOKEN: !!WHATSAPP_TOKEN,
        WHATSAPP_PHONE_NUMBER_ID: !!WHATSAPP_PHONE_NUMBER_ID,
        WHATSAPP_APP_SECRET: !!WHATSAPP_APP_SECRET,
        WHATSAPP_VERIFY_TOKEN: !!WHATSAPP_VERIFY_TOKEN,
        WHATSAPP_ASSISTANT_SECRET: !!WHATSAPP_ASSISTANT_SECRET,
      },
      graph_version: WHATSAPP_GRAPH_VERSION,
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  }

  // ── GET — verificación del webhook por Meta ────────────────────────────
  if (req.method === "GET") {
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    if (mode === "subscribe" && WHATSAPP_VERIFY_TOKEN && token === WHATSAPP_VERIFY_TOKEN) {
      return new Response(challenge ?? "", { status: 200, headers: { "Content-Type": "text/plain" } });
    }
    return new Response("Forbidden", { status: 403 });
  }

  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const faltante = Object.entries(SECRETS_REQUERIDOS).find(([, v]) => !v);
  if (faltante) {
    console.error(`[whatsapp-webhook] falta el secret ${faltante[0]} — edge apagada hasta configurarlo.`);
    return new Response(JSON.stringify({ error: `Falta configurar ${faltante[0]}` }), { status: 503, headers: { "Content-Type": "application/json" } });
  }

  const cuerpoCrudo = await req.text();
  const firmaOk = await verificarFirmaMeta(cuerpoCrudo, req.headers.get("X-Hub-Signature-256"), WHATSAPP_APP_SECRET!);
  if (!firmaOk) {
    console.error("[whatsapp-webhook] firma inválida — posible solicitud falsificada.");
    return new Response("Invalid signature", { status: 401 });
  }

  let payload: Any;
  try { payload = JSON.parse(cuerpoCrudo); } catch { return new Response("Bad request", { status: 400 }); }

  // ── Acusa recibo YA (Meta reintenta si tarda >~10-20s) y procesa después ──
  const sb = admin();
  const cfg = graphCfg();
  const trabajo = (async () => {
    for (const entry of payload.entry ?? []) {
      for (const change of entry.changes ?? []) {
        if (change.field !== "messages") continue;
        try { await procesarValue(sb, cfg, change.value); }
        catch (e) { console.error("[whatsapp-webhook] error procesando value:", e); }
      }
    }
  })();

  // @ts-ignore — EdgeRuntime existe en el runtime de Supabase Edge Functions (Deno Deploy).
  if (typeof EdgeRuntime !== "undefined") {
    // @ts-ignore
    EdgeRuntime.waitUntil(trabajo);
  } else {
    await trabajo; // entorno de pruebas locales sin EdgeRuntime
  }

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } });
});
