import { FunctionsHttpError } from '@supabase/supabase-js';

/**
 * Las Edge Functions devuelven `{ error: "..." }` (y a veces más campos) en el
 * body ante un fallo, pero `functions.invoke()` solo entrega un
 * `FunctionsHttpError` genérico. Estos helpers recuperan el body real.
 */
export async function edgeErrorDetail(error: unknown): Promise<{ message: string; body?: Record<string, unknown> }> {
  if (error instanceof FunctionsHttpError) {
    try {
      const body = (await error.context.json()) as Record<string, unknown>;
      const msg = typeof body?.['error'] === 'string' ? (body['error'] as string) : 'Error inesperado.';
      return { message: msg, body };
    } catch {
      /* fall through */
    }
  }
  return { message: error instanceof Error ? error.message : 'Error inesperado.' };
}

export async function edgeErrorMessage(error: unknown): Promise<string> {
  return (await edgeErrorDetail(error)).message;
}
