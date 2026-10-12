import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PracticaClienteService } from './practica-cliente.service';

/**
 * CM7 (F7a) — candado de red: en práctica, NADA sale a la red salvo
 * `practica_guardar_intento`. Prueba el `fetch` de práctica directamente con un
 * `realFetch` espía (sin crear el cliente supabase ni tocar la red).
 */
describe('PracticaClienteService — candado de red', () => {
  let svc: PracticaClienteService;
  let realSpy: ReturnType<typeof vi.fn>;
  const ORIGIN = 'https://proyecto.supabase.co';

  // Llama al fetch de práctica (privado) con una URL de supabase.
  const call = (p: string, init?: RequestInit) =>
    (svc as unknown as { practicaFetch: (u: string, i?: RequestInit) => Promise<Response> }).practicaFetch(ORIGIN + p, init);

  beforeEach(() => {
    svc = new PracticaClienteService();
    realSpy = vi.fn(async () => new Response('{"ok":true}', { status: 200 }));
    (svc as unknown as { realFetch: typeof fetch }).realFetch = realSpy as unknown as typeof fetch;
    svc.entrar({
      tablas: { proyectos: [{ id: 'obra-norte', nombre: 'OBRA DEMO' }] },
      rpc: { stock_bodega: [{ articulo_id: 'a1', cantidad: 10 }] },
      funciones: { 'leer-recibo': { total: 123 } },
    });
  });

  it('una LECTURA de tabla sale del escenario, NO de la red', async () => {
    const res = await call('/rest/v1/proyectos?select=*');
    expect(realSpy).not.toHaveBeenCalled();
    expect(await res.json()).toEqual([{ id: 'obra-norte', nombre: 'OBRA DEMO' }]);
  });

  it('una tabla sin escenario devuelve vacío, NO sale a la red', async () => {
    const res = await call('/rest/v1/vehiculos?select=*');
    expect(realSpy).not.toHaveBeenCalled();
    expect(await res.json()).toEqual([]);
  });

  it('un RPC cualquiera sale del escenario, NO de la red', async () => {
    const res = await call('/rest/v1/rpc/stock_bodega', { method: 'POST', body: '{}' });
    expect(realSpy).not.toHaveBeenCalled();
    expect(await res.json()).toEqual([{ articulo_id: 'a1', cantidad: 10 }]);
  });

  it('una ESCRITURA se guarda en memoria y NO sale a la red', async () => {
    const res = await call('/rest/v1/solicitudes_material', {
      method: 'POST',
      body: JSON.stringify({ proyecto_id: 'obra-norte', nota: 'prueba' }),
    });
    expect(realSpy).not.toHaveBeenCalled();
    expect(res.status).toBe(201);
    expect(svc.escrituras).toHaveLength(1);
    expect(svc.escrituras[0]).toMatchObject({ tabla: 'solicitudes_material', metodo: 'POST' });
  });

  it('un RPC de escritura (crear_...) se guarda en memoria y NO sale a la red', async () => {
    svc.entrar({ rpc: { crear_solicitud_material: 'practica-req-0001' } });
    const res = await call('/rest/v1/rpc/crear_solicitud_material', {
      method: 'POST',
      body: JSON.stringify({ p_proyecto_id: 'obra-norte', p_items: [{ articulo_id: 'a1', cantidad: 5 }] }),
    });
    expect(realSpy).not.toHaveBeenCalled();
    expect(await res.json()).toBe('practica-req-0001');
    const w = svc.escrituras.find((e) => e.tabla === 'rpc:crear_solicitud_material');
    expect(w).toBeTruthy();
    expect((w!.body as { p_proyecto_id: string }).p_proyecto_id).toBe('obra-norte');
  });

  it('una edge function desconocida devuelve "No disponible", NO sale a la red', async () => {
    const res = await call('/functions/v1/edge-que-no-existe', { method: 'POST', body: '{}' });
    expect(realSpy).not.toHaveBeenCalled();
    expect(await res.json()).toEqual({ error: 'No disponible en práctica' });
  });

  it('SOLO `practica_guardar_intento` sale de verdad a la red', async () => {
    await call('/rest/v1/rpc/practica_guardar_intento', { method: 'POST', body: '{}' });
    expect(realSpy).toHaveBeenCalledTimes(1);
    expect(svc.salidasReales).toEqual(['practica_guardar_intento']);
  });

  it('tras varias operaciones, el candado solo tiene guardar_intento', async () => {
    await call('/rest/v1/proyectos?select=*');
    await call('/rest/v1/rpc/stock_bodega', { method: 'POST', body: '{}' });
    await call('/rest/v1/solicitudes_material', { method: 'POST', body: '{}' });
    await call('/functions/v1/leer-recibo', { method: 'POST', body: '{}' });
    await call('/rest/v1/rpc/practica_guardar_intento', { method: 'POST', body: '{}' });
    expect(svc.salidasReales).toEqual(['practica_guardar_intento']);
    expect(realSpy).toHaveBeenCalledTimes(1);
  });
});
