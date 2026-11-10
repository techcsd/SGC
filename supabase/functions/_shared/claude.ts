// _shared/claude.ts — DB2. Llamada directa a la API de Anthropic (sin
// herramientas), reusada por `wa-ingest` (consulta_grupo — respuesta
// RESTRINGIDA al archivo de un solo grupo, nunca ve otros grupos ni
// herramientas de SGC) y `wa-extract` (extracción de hallazgos, descripción de
// imágenes, resúmenes). `assistant`/`mcp` tienen su propio flujo con
// herramientas (`_shared/herramientas.ts`) — esto es deliberadamente más
// simple: un mensaje, sin tool use, con o sin bloques de imagen.
//
// Mismo convenio de modelo que el resto del repo (leer-recibo, assistant):
// variable de entorno específica → ASSISTANT_MODEL → default fijo.

// deno-lint-ignore no-explicit-any
type Any = any;

export interface BloqueTexto { type: "text"; text: string }
export interface BloqueImagen { type: "image"; source: { type: "base64"; media_type: string; data: string } }
// Soporte nativo de Anthropic para PDFs (y algunos text/*) -- mismo shape que
// BloqueImagen, media_type suele ser "application/pdf".
export interface BloqueDocumento { type: "document"; source: { type: "base64"; media_type: string; data: string } }
export type BloqueContenido = BloqueTexto | BloqueImagen | BloqueDocumento;

export interface MensajeClaude { role: "user" | "assistant"; content: string | BloqueContenido[] }

export interface LlamadaClaudeResultado {
  texto: string;
  tokensIn: number;
  tokensOut: number;
  modelo: string;
}

export class ErrorClaude extends Error {
  constructor(public status: number, public detalle: string) {
    super(`Anthropic ${status}: ${detalle.slice(0, 300)}`);
  }
}

export async function llamarClaude(opts: {
  apiKey: string;
  modelo: string;
  mensajes: MensajeClaude[];
  system?: string;
  maxTokens?: number;
}): Promise<LlamadaClaudeResultado> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": opts.apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: opts.modelo,
      max_tokens: opts.maxTokens ?? 1024,
      system: opts.system,
      messages: opts.mensajes,
    }),
  });
  if (!res.ok) {
    const detalle = await res.text();
    throw new ErrorClaude(res.status, detalle);
  }
  const data: Any = await res.json();
  const texto: string = (data?.content ?? []).map((c: Any) => c?.text ?? "").join("").trim();
  return {
    texto,
    tokensIn: data?.usage?.input_tokens ?? 0,
    tokensOut: data?.usage?.output_tokens ?? 0,
    modelo: opts.modelo,
  };
}

// Extrae el primer objeto/array JSON de un texto que puede venir envuelto en
// ```json ... ``` o con texto alrededor (mismo criterio tolerante que
// leer-recibo). Devuelve null si no se pudo parsear.
export function extraerJson<T = Any>(texto: string): T | null {
  const m = texto.match(/[\[{][\s\S]*[\]}]/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]) as T;
  } catch {
    return null;
  }
}

export const MODELO_WA_DEFECTO = "claude-haiku-4-5-20251001";
