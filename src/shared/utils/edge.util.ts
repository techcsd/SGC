import { FunctionsHttpError, FunctionsRelayError, FunctionsFetchError } from '@supabase/supabase-js';

/** Estructura mínima del cliente que invokeEdge necesita (evita el choque de genéricos
 *  de SupabaseClient<…, 'sgc'> vs 'public' — functions/auth son independientes del schema). */
interface EdgeCapableClient {
  functions: { invoke(name: string, options: { body: Record<string, unknown> }): Promise<{ data: unknown; error: unknown }> };
  auth: { refreshSession(): Promise<unknown> };
}

/**
 * Las Edge Functions devuelven `{ error, error_code }` en el body ante un fallo, pero
 * `functions.invoke()` solo entrega un `FunctionsHttpError` genérico. Estos helpers
 * recuperan el body real y, sobre todo (CG5 / regla 16), traducen a un mensaje humano:
 *  - `FunctionsHttpError`  → error de negocio: usa `error_code` → mensaje, o el `error` del body.
 *  - `FunctionsFetchError` / `FunctionsRelayError` → TRANSPORTE (la petición no recibió
 *    respuesta con CORS: worker frío/ocupado, timeout, red). NUNCA mostrar su `.message`
 *    técnico ("Failed to send a request to the Edge Function") al usuario.
 */

// CG5 — error_code (acceso-cedula y futuras edges) → mensaje humano en español.
const EDGE_ERROR_MESSAGES: Record<string, string> = {
  no_auth: 'Tu sesión expiró. Vuelve a iniciar sesión e inténtalo de nuevo.',
  sesion_invalida: 'Tu sesión expiró. Vuelve a iniciar sesión e inténtalo de nuevo.',
  cuerpo_invalido: 'No se pudo procesar la solicitud. Revisa los datos e inténtalo de nuevo.',
  no_autorizado: 'No tienes permiso para esta acción. Solo Administración o Tecnología pueden gestionar accesos.',
  cedula_existe: 'Ya existe un usuario con esa cédula. Usa «Fijar PIN» en su ficha en vez de crear otro.',
  pin_formato: 'El PIN debe tener exactamente 6 dígitos.',
  pin_debil: 'Ese PIN es demasiado fácil de adivinar (repetido, secuencia o la cédula). Elige otro.',
  pin_igual: 'El PIN nuevo debe ser distinto del actual.',
  pin_incorrecto: 'El PIN actual no es correcto.',
  pin_update_fallo: 'No se pudo guardar el PIN. Inténtalo de nuevo.',
  usuario_no_encontrado: 'No se encontró ese usuario.',
  cuenta_con_correo: 'Esa persona inicia sesión con su correo; usa el restablecimiento por correo.',
  tipo_invalido: 'El tipo de acceso no es válido.',
  tipo_solo_alta_directa: 'Ese tipo de acceso se crea con nombre + cédula.',
  falta_datos: 'Faltan datos para crear el acceso (nombre y cédula).',
  crear_acceso_fallo: 'No se pudo crear el acceso. Inténtalo de nuevo.',
  perfil_fallo: 'No se pudo crear el perfil del usuario. Inténtalo de nuevo.',
  rol_inexistente: 'Falta configurar el rol en Administración › Roles.',
  rol_asignar_fallo: 'No se pudo asignar el rol. Inténtalo de nuevo.',
  ficha_no_encontrada: 'No se encontró la ficha.',
  ficha_sin_cedula: 'La ficha no tiene una cédula/documento válido.',
  ya_correo_real: 'Esa persona ya inicia sesión con su correo.',
  enlace_fallo: 'No se pudo enlazar la ficha con su usuario. Inténtalo de nuevo.',
  // Transporte / servidor (sin respuesta con CORS, o 500 interno).
  transporte: 'No se pudo contactar el servicio (conexión o servidor ocupado). Inténtalo de nuevo en unos segundos.',
  interno: 'Ocurrió un error en el servidor. Si el problema persiste, avísale a Tecnología.',
};

function esErrorTransporte(error: unknown): boolean {
  return error instanceof FunctionsFetchError || error instanceof FunctionsRelayError;
}

export async function edgeErrorDetail(error: unknown): Promise<{ message: string; code?: string; body?: Record<string, unknown> }> {
  if (error instanceof FunctionsHttpError) {
    try {
      const body = (await error.context.json()) as Record<string, unknown>;
      const code = typeof body?.['error_code'] === 'string' ? (body['error_code'] as string) : undefined;
      const msg = typeof body?.['error'] === 'string' ? (body['error'] as string) : 'Error inesperado.';
      return { message: msg, code, body };
    } catch {
      /* fall through */
    }
  }
  if (esErrorTransporte(error)) {
    return { message: EDGE_ERROR_MESSAGES['transporte'], code: 'transporte' };
  }
  return { message: error instanceof Error ? error.message : 'Error inesperado.' };
}

/** Mensaje humano (regla 16): mapea error_code → texto, o cae al mensaje del servidor. */
export async function edgeErrorMessage(error: unknown): Promise<string> {
  const detail = await edgeErrorDetail(error);
  if (detail.code && EDGE_ERROR_MESSAGES[detail.code]) return EDGE_ERROR_MESSAGES[detail.code];
  return detail.message;
}

/**
 * CG5 — invoca una edge con blindaje de transporte: si la petición NO recibe respuesta
 * (worker frío/ocupado, token borde), refresca la sesión y REINTENTA una vez; cualquier
 * error sale como mensaje humano. Devuelve el `data` ya validado (lanza `Error` legible).
 */
export async function invokeEdge<T = unknown>(
  client: EdgeCapableClient,
  name: string,
  body: Record<string, unknown>,
  opts: { retries?: number } = {},
): Promise<T> {
  const maxRetries = opts.retries ?? 1;
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const { data, error } = await client.functions.invoke(name, { body });
    if (!error) {
      if (data && typeof data === 'object' && 'error' in (data as Record<string, unknown>) && (data as Record<string, unknown>)['error']) {
        const d = data as Record<string, unknown>;
        const code = typeof d['error_code'] === 'string' ? (d['error_code'] as string) : undefined;
        throw new Error(code && EDGE_ERROR_MESSAGES[code] ? EDGE_ERROR_MESSAGES[code] : String(d['error']));
      }
      return data as T;
    }
    lastError = error;
    // Solo reintenta ante fallo de TRANSPORTE (no ante un error de negocio con respuesta).
    if (esErrorTransporte(error) && attempt < maxRetries) {
      try { await client.auth.refreshSession(); } catch { /* seguimos: el reintento dirá */ }
      continue;
    }
    break;
  }
  throw new Error(await edgeErrorMessage(lastError));
}
