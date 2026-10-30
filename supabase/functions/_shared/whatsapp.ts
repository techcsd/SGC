// _shared/whatsapp.ts — DC3 (ronda DC, rebautizada de DA por colisión de letra de
// ronda — ver HANDOFF). Helpers puros + cliente Graph API para el puente oficial
// de WhatsApp Cloud API (reemplaza n8n/Evolution, no oficial, bloqueado por Meta).
// Nada aquí conoce Supabase ni el esquema `sgc` — son funciones puras + fetch.

// ── Normalización de teléfono — MISMO criterio que sgc.whatsapp_autorizados/
//    whatsapp_resolver (BJ2): últimos 10 dígitos (RD guarda 10 sin código de
//    país; WhatsApp manda '1'+10). '8299663040' ≡ '18299663040'.
export function normalizarTelefono(telefono: string): string {
  const digitos = (telefono ?? "").replace(/\D/g, "");
  return digitos.slice(-10);
}

// ── Firma HMAC-SHA256 del webhook (X-Hub-Signature-256) — comparación en
//    tiempo constante para no filtrar el secreto por timing attack.
export async function verificarFirmaMeta(
  cuerpoCrudo: string,
  headerFirma: string | null,
  appSecret: string,
): Promise<boolean> {
  if (!headerFirma || !headerFirma.startsWith("sha256=")) return false;
  const recibida = headerFirma.slice("sha256=".length);
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(appSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const firma = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(cuerpoCrudo));
  const esperadaHex = Array.from(new Uint8Array(firma)).map((b) => b.toString(16).padStart(2, "0")).join("");
  return comparacionConstante(esperadaHex, recibida.toLowerCase());
}

function comparacionConstante(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ── Markdown (lo que escribe Compa) → texto plano que WhatsApp sabe mostrar.
//    WhatsApp solo soporta *negrita*, _cursiva_, ~tachado~ y ``` monoespaciado ```
//    (y eso con asterisco simple, no doble). Tablas y encabezados no existen —
//    se aplanan a líneas con viñeta.
export function markdownAWhatsapp(texto: string): string {
  if (!texto) return texto;
  let t = texto;

  // Encabezados "# Título" / "## Título" → línea en negrita.
  t = t.replace(/^#{1,6}\s+(.+)$/gm, "*$1*");

  // Enlaces [texto](url) → "texto: url" (WhatsApp no soporta markdown de enlace).
  t = t.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, "$1: $2");

  // Negrita **x** → *x* (WhatsApp usa un solo asterisco).
  t = t.replace(/\*\*(.+?)\*\*/g, "*$1*");

  // Tablas Markdown (|a|b|) → líneas "• a — b" (se detecta por la fila de
  // separador ---|---; si no hay separador, no se toca nada más abajo).
  const lineas = t.split("\n");
  const salida: string[] = [];
  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i];
    const siguiente = lineas[i + 1] ?? "";
    const esFilaTabla = /^\s*\|.*\|\s*$/.test(linea);
    const siguienteEsSeparador = /^\s*\|?[\s:|-]+\|?\s*$/.test(siguiente) && siguiente.includes("-");
    if (esFilaTabla && siguienteEsSeparador) {
      // Encabezado de tabla: se usa como título de sección, se salta el separador.
      const cols = linea.split("|").map((c) => c.trim()).filter(Boolean);
      salida.push(`_${cols.join(" · ")}_`);
      i++; // saltar la fila separadora
      continue;
    }
    if (esFilaTabla) {
      const cols = linea.split("|").map((c) => c.trim()).filter(Boolean);
      salida.push(`• ${cols.join(" — ")}`);
      continue;
    }
    salida.push(linea);
  }
  t = salida.join("\n");

  // Strip de HTML residual (por si algún texto trae etiquetas sueltas).
  t = t.replace(/<[^>]+>/g, "");

  return t.trim();
}

// ── Partir en chunks de máx N caracteres, en borde de párrafo/línea (nunca a
//    mitad de palabra). WhatsApp acepta hasta 4096 caracteres por mensaje de
//    texto; se usa un margen de 4000 por seguridad.
export function dividirEnChunks(texto: string, maxLen = 4000): string[] {
  if (texto.length <= maxLen) return [texto];
  const chunks: string[] = [];
  let resto = texto;
  while (resto.length > maxLen) {
    let corte = resto.lastIndexOf("\n\n", maxLen);
    if (corte < maxLen * 0.4) corte = resto.lastIndexOf("\n", maxLen);
    if (corte < maxLen * 0.4) corte = resto.lastIndexOf(" ", maxLen);
    if (corte <= 0) corte = maxLen;
    chunks.push(resto.slice(0, corte).trim());
    resto = resto.slice(corte).trim();
  }
  if (resto) chunks.push(resto);
  return chunks;
}

// ── Reintento con backoff exponencial + jitter — MISMO patrón que
//    _shared/odoo-backoff.ts (conReintentoLectura), adaptado a respuestas HTTP
//    del Graph API en vez de OdooError: reintenta 429 y 5xx, nunca 4xx de negocio.
export interface OpcionesBackoffHttp {
  intentos?: number;
  baseMs?: number;
  azar?: () => number;
  dormir?: (ms: number) => Promise<void>;
}

export async function conReintentoHttp(
  fn: () => Promise<Response>,
  opts: OpcionesBackoffHttp = {},
): Promise<Response> {
  const intentos = Math.max(1, opts.intentos ?? 3);
  const baseMs = opts.baseMs ?? 300;
  const azar = opts.azar ?? Math.random;
  const dormir = opts.dormir ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));

  let ultima: Response | undefined;
  for (let intento = 0; intento < intentos; intento++) {
    const res = await fn();
    if (res.ok || (res.status !== 429 && res.status < 500)) return res;
    ultima = res;
    if (intento === intentos - 1) return res;
    const expo = baseMs * 2 ** intento;
    const jitter = azar() * expo * 0.5;
    await dormir(expo + jitter);
  }
  return ultima!;
}

// ── Cliente Graph API ────────────────────────────────────────────────────────
export interface GraphConfig {
  token: string;
  phoneNumberId: string;
  graphVersion: string;
}

function graphUrl(cfg: GraphConfig, path: string): string {
  return `https://graph.facebook.com/${cfg.graphVersion}/${path}`;
}

// Marca como leído + muestra "escribiendo…" (un solo POST por mensaje de Meta).
export async function marcarLeidoYEscribiendo(cfg: GraphConfig, waMessageId: string): Promise<void> {
  await conReintentoHttp(() =>
    fetch(graphUrl(cfg, `${cfg.phoneNumberId}/messages`), {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        status: "read",
        message_id: waMessageId,
        typing_indicator: { type: "text" },
      }),
    })
  ).catch(() => {}); // best-effort — nunca bloquea el flujo principal
}

export interface EnvioTextoResultado { ok: boolean; waMessageId: string | null; error?: string }

export async function enviarTextoWhatsapp(
  cfg: GraphConfig,
  telefono: string,
  texto: string,
  opts: { contextoMessageId?: string } = {},
): Promise<EnvioTextoResultado> {
  const body: Record<string, unknown> = {
    messaging_product: "whatsapp",
    to: telefono,
    type: "text",
    text: { body: texto, preview_url: true },
  };
  if (opts.contextoMessageId) body.context = { message_id: opts.contextoMessageId };
  const res = await conReintentoHttp(() =>
    fetch(graphUrl(cfg, `${cfg.phoneNumberId}/messages`), {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  );
  const texto_ = await res.text();
  if (!res.ok) return { ok: false, waMessageId: null, error: `Graph ${res.status}: ${texto_.slice(0, 300)}` };
  try {
    const j = JSON.parse(texto_);
    return { ok: true, waMessageId: j?.messages?.[0]?.id ?? null };
  } catch {
    return { ok: true, waMessageId: null };
  }
}

export interface MediaInfo { url: string; mimeType: string }

export async function obtenerUrlMedia(cfg: GraphConfig, mediaId: string): Promise<MediaInfo> {
  const res = await conReintentoHttp(() =>
    fetch(graphUrl(cfg, mediaId), { headers: { Authorization: `Bearer ${cfg.token}` } })
  );
  if (!res.ok) throw new Error(`Graph media ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const j = await res.json();
  return { url: j.url, mimeType: j.mime_type ?? "application/octet-stream" };
}

export async function descargarMedia(cfg: GraphConfig, mediaUrl: string): Promise<Blob> {
  const res = await conReintentoHttp(() =>
    fetch(mediaUrl, { headers: { Authorization: `Bearer ${cfg.token}` } })
  );
  if (!res.ok) throw new Error(`descarga media ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return await res.blob();
}

// ── Envía una respuesta larga en varios chunks, con el context (reply-to) solo
//    en el primero. Devuelve el wa_message_id de cada chunk enviado con éxito.
export async function enviarRespuestaLarga(
  cfg: GraphConfig,
  telefono: string,
  texto: string,
  contextoMessageId?: string,
): Promise<EnvioTextoResultado[]> {
  const chunks = dividirEnChunks(markdownAWhatsapp(texto));
  const resultados: EnvioTextoResultado[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const r = await enviarTextoWhatsapp(cfg, telefono, chunks[i], {
      contextoMessageId: i === 0 ? contextoMessageId : undefined,
    });
    resultados.push(r);
    if (!r.ok) break; // si un chunk falla, no sigue mandando los siguientes fuera de orden
  }
  return resultados;
}
