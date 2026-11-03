import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PracticaClienteService } from './practica-cliente.service';
import { MISIONES_PILOTO } from './practica.data';
import { MisionPractica } from './practica.model';

/**
 * F6 (DG5) — candado de red de PUNTA A PUNTA: para CADA misión del módulo Demo que usa
 * una pantalla real (`rutaReal` + `metaWrite`), simula "entrar" con su escenario y disparar
 * la escritura que marca la misión como completada (`metaWrite`), y verifica que NADA salió
 * a la red de verdad — ni esa escritura ni ninguna otra. Mismo mecanismo que
 * `practica-cliente.spec.ts` (fetch real espiado), pero recorriendo el catálogo completo en
 * vez de un solo caso a mano, así que cubre las 8 misiones nuevas de F6 y las 6 anteriores.
 */
describe('Módulo Demo — candado de red por misión (punta a punta)', () => {
  let svc: PracticaClienteService;
  let realSpy: ReturnType<typeof vi.fn>;
  const ORIGIN = 'https://proyecto.supabase.co';

  const call = (p: string, init?: RequestInit) =>
    (svc as unknown as { practicaFetch: (u: string, i?: RequestInit) => Promise<Response> }).practicaFetch(ORIGIN + p, init);

  beforeEach(() => {
    svc = new PracticaClienteService();
    realSpy = vi.fn(async () => new Response('{"ok":true}', { status: 200 }));
    (svc as unknown as { realFetch: typeof fetch }).realFetch = realSpy as unknown as typeof fetch;
  });

  /** Construye un body mínimo plausible para la escritura `metaWrite` de la misión,
   *  usando sus propios `objetivosReales` como pista de qué claves espera. */
  function bodyMinimoPara(mision: MisionPractica): Record<string, unknown> {
    const body: Record<string, unknown> = {};
    const texto = JSON.stringify(mision.objetivosReales ?? []);
    // Heurística simple: cualquier `p_<algo>` o clave de tabla mencionada en los objetivos
    // reales se rellena con un valor "verdadero" genérico para que la escritura cuente.
    const claves = new Set<string>();
    for (const m of texto.matchAll(/p_[a-z_]+/g)) claves.add(m[0]);
    for (const clave of claves) body[clave] = clave.includes('item') ? [{ cantidad: 1 }] : 'practica-valor';
    // Las misiones con escritura de tabla (no RPC) usan nombres de columna simples.
    for (const campo of ['vehiculo_id', 'origen', 'destino', 'tipo']) body[campo] = 'practica-valor';
    return body;
  }

  const misionesPantallaReal = MISIONES_PILOTO.filter((m) => m.rutaReal && m.metaWrite);

  it('el catálogo tiene al menos las 13 misiones de pantalla real esperadas (5 originales + 8 de F6)', () => {
    // MISION_TRANSFERIR_CONDUCE no tiene rutaReal (formulario simplificado legacy) —
    // las otras 5 originales + las 8 nuevas de F6 sí.
    expect(misionesPantallaReal.length).toBeGreaterThanOrEqual(13);
  });

  for (const mision of misionesPantallaReal) {
    it(`"${mision.titulo}" (${mision.id}) — completar la misión no hace NINGUNA llamada real`, async () => {
      svc.entrar(mision.escenario ?? {});

      const metaWrite = mision.metaWrite!;
      const esRpc = metaWrite.startsWith('rpc:');
      const nombre = esRpc ? metaWrite.slice('rpc:'.length) : metaWrite;
      const path = esRpc ? `/rest/v1/rpc/${nombre}` : `/rest/v1/${nombre}`;

      const res = await call(path, { method: 'POST', body: JSON.stringify(bodyMinimoPara(mision)) });
      expect(res.status).toBeLessThan(400);

      // Candado: NADA salió a la red real.
      expect(realSpy).not.toHaveBeenCalled();
      expect(svc.salidasReales).toEqual([]);

      // La escritura quedó capturada en memoria (por eso `metaCumplida()` la detecta).
      const escritura = svc.escrituras.find((e) => e.tabla === metaWrite);
      expect(escritura).toBeTruthy();
    });
  }

  it('al final de todas las misiones, el candado global sigue vacío', async () => {
    for (const mision of misionesPantallaReal) {
      svc.entrar(mision.escenario ?? {});
      const metaWrite = mision.metaWrite!;
      const esRpc = metaWrite.startsWith('rpc:');
      const nombre = esRpc ? metaWrite.slice('rpc:'.length) : metaWrite;
      const path = esRpc ? `/rest/v1/rpc/${nombre}` : `/rest/v1/${nombre}`;
      await call(path, { method: 'POST', body: JSON.stringify(bodyMinimoPara(mision)) });
    }
    expect(realSpy).not.toHaveBeenCalled();
    expect(svc.salidasReales).toEqual([]);
  });
});
