import { describe, it, expect } from 'vitest';
import { FunctionsFetchError, FunctionsHttpError } from '@supabase/supabase-js';
import { edgeErrorMessage, invokeEdge } from './edge.util';

const httpError = (body: unknown, status = 502) =>
  new FunctionsHttpError(new Response(JSON.stringify(body), { status }));

const cliente = (resp: { data: unknown; error: unknown }) => ({
  functions: { invoke: async () => resp },
  auth: { refreshSession: async () => ({}) },
});

describe('edge.util — errores de IA (DX1/DX2)', () => {
  it('un fallo de IA NO se presenta como problema de conexión', async () => {
    const msg = await edgeErrorMessage(httpError({ ok: false, error_code: 'ia_sin_credito', error: 'x' }));
    expect(msg).toContain('servicio de IA');
    expect(msg).not.toContain('conexión');
  });

  it('transporte real (sin respuesta) sigue diciendo conexión', async () => {
    const msg = await edgeErrorMessage(new FunctionsFetchError(new Error('Failed to fetch')));
    expect(msg).toContain('conexión');
  });

  it('ia_limite y ia_tiempo_agotado tienen mensajes propios', async () => {
    const a = await edgeErrorMessage(httpError({ error_code: 'ia_limite' }));
    const b = await edgeErrorMessage(httpError({ error_code: 'ia_tiempo_agotado' }));
    expect(a).toContain('ocupado');
    expect(b).toContain('tardó');
  });

  it('invokeEdge lanza el mensaje humano del error_code de IA', async () => {
    await expect(invokeEdge(cliente({ data: null, error: httpError({ error_code: 'ia_modelo_no_disponible' }) }), 'assistant', {}))
      .rejects.toThrow(/servicio de IA/);
  });
});
