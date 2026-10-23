// PoC Odoo — el servicio solo habla con el gateway `odoo-api` y propaga errores
// (sin fallback a tablas locales). Instancia por prototipo para no inyectar Supabase.
import { describe, it, expect, vi } from 'vitest';
import { OdooApiService } from './odoo-api.service';
import { esOdooId } from '../models/odoo.model';
import { FunctionsHttpError } from '@supabase/supabase-js';

const httpError = (status: number, body: unknown) =>
  new FunctionsHttpError(new Response(JSON.stringify(body), { status }));

function servicio(invoke: (name: string, opts: { body: unknown }) => Promise<unknown>) {
  const svc = Object.create(OdooApiService.prototype) as OdooApiService;
  (svc as unknown as { supabase: unknown }).supabase = { client: { functions: { invoke } } };
  return svc;
}

describe('OdooApiService', () => {
  it('stock.consultar invoca SOLO odoo-api con accion + params tipados', async () => {
    const invoke = vi.fn().mockResolvedValue({ data: { data: { pagina: 1, tamano: 25, hay_mas: false, filas: [] }, consultado_en: '2026-10-23T12:00:00Z', cache: 'miss' }, error: null });
    const r = await servicio(invoke).consultarStock({ producto_id: 5, ubicacion_id: 8, pagina: 1, tamano: 25 });
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith('odoo-api', { body: { accion: 'stock.consultar', params: { producto_id: 5, ubicacion_id: 8, pagina: 1, tamano: 25 } } });
    expect(r.data.filas).toEqual([]);
    expect(r.cache).toBe('miss');
    expect(r.consultado_en).toBe('2026-10-23T12:00:00Z');
  });

  it('un error del gateway se propaga (sin fallback)', async () => {
    const invoke = vi.fn().mockResolvedValue({ data: null, error: new Error('Odoo no respondió a tiempo.') });
    await expect(servicio(invoke).listarUbicaciones()).rejects.toThrow('Odoo no respondió a tiempo.');
  });

  it('incluye el código técnico del gateway en el detalle (solo lo muestra error-state a desarrolladores)', async () => {
    const error = httpError(504, { error: 'Odoo no respondió a tiempo.', error_code: 'odoo_timeout' });
    await expect(servicio(vi.fn().mockResolvedValue({ data: null, error })).consultarStock({})).rejects.toThrow(/odoo_timeout/);
  });

  it('403 se marca como acceso denegado para el mensaje por rol', async () => {
    const error = httpError(403, { error: 'Tu rol no tiene acceso a esta información.' });
    const invoke = vi.fn().mockResolvedValue({ data: null, error });
    await expect(servicio(invoke).buscarProductos('cem')).rejects.toThrow(/forbidden/);
  });
});

describe('esOdooId', () => {
  it('acepta enteros positivos seguros y rechaza UUID/negativos/flotantes', () => {
    expect(esOdooId(42)).toBe(true);
    expect(esOdooId('b3f1c2a0-0000-4000-8000-000000000000')).toBe(false);
    expect(esOdooId(-1)).toBe(false);
    expect(esOdooId(1.5)).toBe(false);
    expect(esOdooId(2 ** 60)).toBe(false);
  });
});
