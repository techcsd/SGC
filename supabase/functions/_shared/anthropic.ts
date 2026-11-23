// _shared/anthropic.ts — DX1/DX2 (ronda 23-nov-2026). Única puerta a api.anthropic.com
// desde las edges: timeout duro, UN reintento en 429/529/5xx/red y errores TIPADOS.
//
// Por qué existe: `assistant` (Compa) y `resumir-reporte` hacían `fetch` SIN tiempo
// límite; si Anthropic tardaba, Supabase cortaba la función y el navegador veía un
// FunctionsFetchError ("No se pudo contactar el servicio (conexión...)"), idéntico a
// "se cayó tu internet" y sin rastro en el log. Aquí cada fallo sale como JSON con
// `error_code` (+ status y request-id de Anthropic) y CORS.
//
// El modelo NUNCA se decide aquí: lo pasa quien llama desde sus secrets.

// deno-lint-ignore no-explicit-any
type Any = any;

export type CodigoErrorIA =
  | "ia_sin_credito"
  | "ia_limite"
  | "ia_modelo_no_disponible"
  | "ia_tiempo_agotado"
  | "ia_error";

export class ErrorIA extends Error {
  constructor(
    public codigo: CodigoErrorIA,
    public status: number,
    public requestId: string | null,
    public detalle: string,
  ) {
    super(`${codigo} (status ${status}${requestId ? `, request-id ${requestId}` : ""}): ${detalle.slice(0, 300)}`);
    this.name = "ErrorIA";
  }
}

export const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
export const TIMEOUT_IA_MS = 45_000;
export const ESPERA_REINTENTO_MS = 1_500;

/** Traduce el status/cuerpo de Anthropic al código tipado. */
export function clasificarErrorIA(status: number, cuerpo: string): CodigoErrorIA {
  const t = (cuerpo ?? "").toLowerCase();
  if (status === 402 || t.includes("credit balance") || t.includes("billing") || t.includes("insufficient")) return "ia_sin_credito";
  if (status === 429) return t.includes("credit") ? "ia_sin_credito" : "ia_limite";
  if (status === 404 || (status === 400 && t.includes("model") && (t.includes("not found") || t.includes("invalid") || t.includes("deprecated") || t.includes("retired")))) {
    return "ia_modelo_no_disponible";
  }
  if (status === 529 || status === 503) return "ia_limite";
  return "ia_error";
}

const reintentable = (status: number) => status === 429 || status === 529 || status >= 500;

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface OpcionesFetchIA {
  timeoutMs?: number;
  esperaReintentoMs?: number;
  /** Solo para tests. */
  fetchImpl?: typeof fetch;
}

/**
 * Drop-in de `fetch("https://api.anthropic.com/v1/messages", …)`: devuelve una
 * Response OK o LANZA `ErrorIA`. Nunca devuelve una Response no-ok.
 */
export async function fetchAnthropic(apiKey: string, body: Any, opts: OpcionesFetchIA = {}): Promise<Response> {
  const f = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? TIMEOUT_IA_MS;
  const espera = opts.esperaReintentoMs ?? ESPERA_REINTENTO_MS;
  let ultimo: ErrorIA | null = null;

  for (let intento = 0; intento < 2; intento++) {
    try {
      const res = await f(ANTHROPIC_URL, {
        method: "POST",
        headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: typeof body === "string" ? body : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.ok) return res;
      const cuerpo = await res.text().catch(() => "");
      const requestId = res.headers.get("request-id");
      ultimo = new ErrorIA(clasificarErrorIA(res.status, cuerpo), res.status, requestId, cuerpo);
      // sin crédito / modelo inexistente no se arregla reintentando
      if (!reintentable(res.status) || ultimo.codigo === "ia_sin_credito" || ultimo.codigo === "ia_modelo_no_disponible") throw ultimo;
    } catch (e) {
      if (e instanceof ErrorIA) {
        if (!reintentable(e.status) || e.codigo === "ia_sin_credito" || e.codigo === "ia_modelo_no_disponible") throw e;
        ultimo = e;
      } else {
        const abortado = (e as Error)?.name === "TimeoutError" || (e as Error)?.name === "AbortError";
        ultimo = new ErrorIA(abortado ? "ia_tiempo_agotado" : "ia_error", 0, null, String((e as Error)?.message ?? e));
      }
    }
    if (intento === 0) await dormir(espera);
  }
  throw ultimo!;
}

export interface RespuestaIA {
  texto: string;
  stopReason: string;
  tokensIn: number;
  tokensOut: number;
  json: Any;
}

/** fetchAnthropic + parseo del JSON de Messages. */
export async function llamarAnthropic(apiKey: string, body: Any, opts: OpcionesFetchIA = {}): Promise<RespuestaIA> {
  const res = await fetchAnthropic(apiKey, body, opts);
  const json: Any = await res.json();
  return {
    json,
    texto: (json?.content ?? []).map((c: Any) => c?.text ?? "").join("").trim(),
    stopReason: String(json?.stop_reason ?? "desconocido"),
    tokensIn: json?.usage?.input_tokens ?? 0,
    tokensOut: json?.usage?.output_tokens ?? 0,
  };
}

/** Mensaje humano en español (el front lo mapea otra vez por `error_code`). */
export function mensajeErrorIA(codigo: CodigoErrorIA): string {
  switch (codigo) {
    case "ia_sin_credito": return "El servicio de IA no está disponible ahora. Ya se avisó a Tecnología; inténtalo en unos minutos.";
    case "ia_limite": return "El servicio de IA está muy ocupado. Inténtalo de nuevo en unos segundos.";
    case "ia_modelo_no_disponible": return "El servicio de IA no está disponible ahora. Ya se avisó a Tecnología; inténtalo en unos minutos.";
    case "ia_tiempo_agotado": return "La IA tardó demasiado en responder. Inténtalo de nuevo.";
    default: return "El servicio de IA no está disponible ahora. Ya se avisó a Tecnología; inténtalo en unos minutos.";
  }
}

/** Cuerpo JSON estándar de error de IA (sin datos personales; con el request-id para Tecnología). */
export function cuerpoErrorIA(e: ErrorIA) {
  return {
    ok: false,
    error: mensajeErrorIA(e.codigo),
    error_code: e.codigo,
    ia_status: e.status,
    ia_request_id: e.requestId,
  };
}

// deno-lint-ignore no-explicit-any
type Cliente = any;

/**
 * Registra la causa real en `sgc.app_error_reports` (firma estable por
 * `error_code`+función → el Vigía/Pulso la agrupan). Sin datos personales:
 * solo función, código, status y request-id. Nunca lanza.
 */
export async function registrarFalloIA(svc: Cliente, userId: string | null, funcion: string, e: ErrorIA, modelo?: string): Promise<void> {
  try {
    await svc.from("app_error_reports").insert({
      user_id: userId,
      error_type: "other",
      message: `ia:${e.codigo} · ${funcion}`,
      stack: "",
      context: { funcion, error_code: e.codigo, ia_status: e.status, ia_request_id: e.requestId, modelo: modelo ?? null, detalle: e.detalle.slice(0, 300) },
      platform: "edge",
      app_version: "edge",
      device_brand: "Supabase",
      device_model: "edge-function",
      os_version: "deno",
      source: "web",
    });
  } catch (_e) { /* el log nunca debe romper la respuesta */ }
}

/**
 * Envuelve un handler de `Deno.serve`: cualquier excepción no atrapada sale como
 * `{ ok:false, error_code:"error_interno", error }` CON CORS, para que el front
 * nunca confunda "falló mi código" con "no hay red".
 */
export function envolverServe(
  nombre: string,
  handler: (req: Request) => Promise<Response>,
  cors: (req: Request) => Record<string, string>,
): (req: Request) => Promise<Response> {
  return async (req: Request) => {
    try {
      return await handler(req);
    } catch (e) {
      console.error(`${nombre}: excepción no atrapada`, e);
      if (e instanceof ErrorIA) {
        return new Response(JSON.stringify(cuerpoErrorIA(e)), { status: 502, headers: { ...cors(req), "Content-Type": "application/json" } });
      }
      return new Response(
        JSON.stringify({ ok: false, error_code: "error_interno", error: "Ocurrió un error inesperado. Ya se avisó a Tecnología." }),
        { status: 500, headers: { ...cors(req), "Content-Type": "application/json" } },
      );
    }
  };
}
