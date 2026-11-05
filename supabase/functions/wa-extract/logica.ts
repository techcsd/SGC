// logica.ts — DB-S4 — funciones puras de wa-extract (sin red/DB), para poder
// probarlas con `deno test` sin mockear Supabase/Claude. index.ts solo orquesta
// I/O y llama a estas.

// deno-lint-ignore no-explicit-any
export type Any = any;

// ── 1) Pre-filtro de bajo-señal (sin costo de IA) ───────────────────────────
// Mensajes que NUNCA valen una llamada a Claude: stickers, vacíos, o texto muy
// corto sin contenido operativo (saludos, confirmaciones triviales, emojis
// sueltos). Mismo criterio de "charla sin contenido" que describe el prompt
// de extracción — esto es la versión barata (regex) aplicada ANTES de gastar
// tokens, no un reemplazo del juicio de Claude sobre el resto.
const PALABRAS_BAJO_SENAL = new Set([
  "ok", "oka", "okay", "dale", "listo", "bien", "gracias", "grasias", "de nada",
  "hola", "buenas", "buenos dias", "buenas tardes", "buenas noches", "adios",
  "si", "sí", "no", "vale", "perfecto", "excelente", "genial", "jaja", "jajaja",
  "jeje", "lol", "ok gracias", "oka gracias", "entendido", "recibido", "copiado",
]);

// Quita emojis, signos de puntuación y espacios repetidos para comparar contra
// la lista de palabras de bajo-señal.
function normalizarTextoCorto(texto: string): string {
  return texto
    .toLowerCase()
    .trim()
    // deno-lint-ignore no-control-regex
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}]/gu, "")
    .replace(/[¡!¿?.,;:()"'`~-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export interface MensajeParaFiltro {
  tipo: string;
  texto?: string | null;
  transcripcion?: string | null;
  descripcion_media?: string | null;
}

// true → el mensaje se puede marcar procesado=true SIN llamar a IA (ni
// extracción ni visión/STT). false → sigue en el pipeline normal.
export function esMensajeBajoSenal(m: MensajeParaFiltro): boolean {
  if (m.tipo === "sticker" || m.tipo === "ubicacion" || m.tipo === "contacto") return true;
  const texto = (m.texto ?? "").trim();
  if (m.tipo === "texto") {
    if (!texto) return true; // texto vacío (p.ej. solo emoji que WhatsApp reportó como texto vacío)
    const normalizado = normalizarTextoCorto(texto);
    if (!normalizado) return true; // era solo emojis/puntuación
    if (normalizado.length <= 2) return true; // "ok", "si", etc tras normalizar
    if (PALABRAS_BAJO_SENAL.has(normalizado)) return true;
    // Frases de 2-3 palabras donde CADA palabra es de bajo-señal (ej. "ok gracias dale").
    const palabras = normalizado.split(" ");
    if (palabras.length <= 3 && palabras.every((p) => PALABRAS_BAJO_SENAL.has(p))) return true;
  }
  return false;
}

// ── 2) Validador de forma de hallazgo (lo que devuelve Claude) ─────────────
export const TIPOS_HALLAZGO_VALIDOS = new Set([
  "acuerdo", "tarea", "pedido_material", "incidente", "decision", "monto",
  "fecha_limite", "cambio_de_plan", "pregunta_abierta", "contacto", "otro",
]);

export interface HallazgoValidado {
  tipo: string;
  resumen: string;
  detalle: string | null;
  personas: string[];
  fecha_mencionada: string | null;
  monto: number | null;
  moneda: string | null;
  confianza: number | null;
  mensaje_ids: string[];
}

const RE_FECHA_ISO = /^\d{4}-\d{2}-\d{2}$/;

// Valida UN item crudo del array que devolvió Claude contra el esquema de
// wa_hallazgos. Devuelve null si el item es inválido (nunca lanza) — el
// llamador simplemente descarta los inválidos y sigue con el resto.
// `idsPermitidos`, si se pasa, filtra mensaje_ids a solo los ids reales del
// batch (defensa extra contra ids inventados).
export function validarHallazgo(item: Any, idsPermitidos?: Set<string>): HallazgoValidado | null {
  if (!item || typeof item !== "object") return null;
  const tipo = typeof item.tipo === "string" ? item.tipo : "";
  if (!TIPOS_HALLAZGO_VALIDOS.has(tipo)) return null;
  const resumen = typeof item.resumen === "string" ? item.resumen.trim() : "";
  if (!resumen) return null;

  let mensajeIds: string[] = Array.isArray(item.mensaje_ids)
    ? item.mensaje_ids.filter((x: Any) => typeof x === "string" && x.trim()).map((x: string) => x.trim())
    : [];
  if (idsPermitidos) mensajeIds = mensajeIds.filter((id) => idsPermitidos.has(id));

  const personas = Array.isArray(item.personas)
    ? item.personas.filter((x: Any) => typeof x === "string" && x.trim()).map((x: string) => x.trim())
    : [];

  const fechaMencionada = typeof item.fecha_mencionada === "string" && RE_FECHA_ISO.test(item.fecha_mencionada)
    ? item.fecha_mencionada : null;

  const monto = typeof item.monto === "number" && Number.isFinite(item.monto) ? item.monto : null;
  const moneda = typeof item.moneda === "string" && item.moneda.trim() ? item.moneda.trim().toUpperCase().slice(0, 10) : null;

  let confianza: number | null = typeof item.confianza === "number" && Number.isFinite(item.confianza) ? item.confianza : null;
  if (confianza !== null) confianza = Math.min(1, Math.max(0, confianza));

  const detalle = typeof item.detalle === "string" && item.detalle.trim() ? item.detalle.trim() : null;

  return {
    tipo, resumen, detalle, personas,
    fecha_mencionada: fechaMencionada,
    monto, moneda, confianza,
    mensaje_ids: mensajeIds,
  };
}

// Valida un array completo, descartando silenciosamente los items inválidos.
export function validarHallazgos(arr: Any, idsPermitidos?: Set<string>): HallazgoValidado[] {
  if (!Array.isArray(arr)) return [];
  const out: HallazgoValidado[] = [];
  for (const item of arr) {
    const v = validarHallazgo(item, idsPermitidos);
    if (v) out.push(v);
  }
  return out;
}

// ── 3) Presupuesto diario de tokens de IA ───────────────────────────────────
// null/undefined en budgetTokensDia = sin tope (wa_config.budget_tokens_dia
// es nullable a propósito). Devuelve true si YA se debe dejar de gastar.
export function presupuestoExcedido(tokensHoy: number, budgetTokensDia: number | null | undefined): boolean {
  if (budgetTokensDia === null || budgetTokensDia === undefined) return false;
  if (!Number.isFinite(budgetTokensDia) || budgetTokensDia <= 0) return false;
  return tokensHoy >= budgetTokensDia;
}

// ── 4) Dead-man / latido del listener ───────────────────────────────────────
const ESTADOS_LATIDO_MALO = new Set(["sesion_cerrada", "posible_baneo"]);
const VENTANA_LATIDO_MS = 10 * 60 * 1000; // 10 minutos

export function latidoCaido(estado: string, ultimoLatidoEn: string | null, ahoraMs: number = Date.now()): boolean {
  if (ESTADOS_LATIDO_MALO.has(estado)) return true;
  if (!ultimoLatidoEn) return true;
  const t = new Date(ultimoLatidoEn).getTime();
  if (!Number.isFinite(t)) return true;
  return (ahoraMs - t) > VENTANA_LATIDO_MS;
}

// ── 5) Límite diario de visión ──────────────────────────────────────────────
export function visionLimiteAlcanzado(usadosHoy: number, limiteDiario: number): boolean {
  if (!Number.isFinite(limiteDiario) || limiteDiario <= 0) return true;
  return usadosHoy >= limiteDiario;
}

// ── 6) Construcción del prompt de usuario para la extracción ───────────────
export interface MensajeParaPrompt {
  id: string;
  autor_nombre: string | null;
  autor_telefono: string;
  texto: string | null;
  transcripcion: string | null;
  descripcion_media: string | null;
  tipo: string;
  enviado_en: string;
}

function lineaMensaje(m: MensajeParaPrompt): string {
  const quien = m.autor_nombre?.trim() || m.autor_telefono || "alguien";
  const contenido = m.texto ?? m.transcripcion ?? m.descripcion_media ?? `(${m.tipo} sin contenido legible)`;
  return `[id=${m.id}] [${m.enviado_en}] ${quien}: ${contenido}`;
}

export function construirPromptExtraccion(contexto: MensajeParaPrompt[], batch: MensajeParaPrompt[]): string {
  const bloqueContexto = contexto.length
    ? contexto.map(lineaMensaje).join("\n")
    : "(sin contexto previo)";
  const bloqueBatch = batch.map(lineaMensaje).join("\n");
  return [
    "CONTEXTO PREVIO (solo para entender la conversación, NO extraigas hallazgos de aquí salvo que un mensaje de abajo lo confirme):",
    bloqueContexto,
    "",
    "MENSAJES A ANALIZAR (extrae hallazgos de estos, usando sus [id=...] en mensaje_ids):",
    bloqueBatch,
    "",
    "Devuelve SOLO el array JSON de hallazgos.",
  ].join("\n");
}
