// CK6 — getConductoresPicker mapea `conductor_id → id` (fuente `choferes_activos`).
// El bug: antes usaba `conductores_para_multa`, que devuelve `conductor_id` y NO `id`,
// así que cada opción salía con `id: undefined` → "undefined" llegaba a un uuid.
import { describe, it, expect } from 'vitest';
import { SalidasService } from './salidas.service';

// Instancia sin correr el inicializador de campo (evita inject(SupabaseService)).
function svcConRpc(filas: unknown[]): SalidasService {
  const svc = Object.create(SalidasService.prototype) as SalidasService;
  (svc as unknown as { supabase: unknown }).supabase = {
    client: { rpc: async () => ({ data: filas, error: null }) },
  };
  return svc;
}

describe('SalidasService.getConductoresPicker', () => {
  it('mapea conductor_id → id (opciones con uuid real)', async () => {
    const svc = svcConRpc([
      { conductor_id: '63ab6be8-2638-4788-bbe9-739f19dce36a', nombre: 'Mendez' },
      { conductor_id: '90181490-6cc8-4147-878e-61ad9253b6db', nombre: 'Carlos' },
    ]);
    const opts = await svc.getConductoresPicker();
    expect(opts).toEqual([
      { id: '63ab6be8-2638-4788-bbe9-739f19dce36a', nombre: 'Mendez' },
      { id: '90181490-6cc8-4147-878e-61ad9253b6db', nombre: 'Carlos' },
    ]);
    // Ninguna opción con id undefined (la causa del error de transferir).
    expect(opts.every((o) => typeof o.id === 'string')).toBe(true);
  });

  it('descarta filas sin conductor_id', async () => {
    const svc = svcConRpc([{ conductor_id: null, nombre: 'X' }]);
    expect(await svc.getConductoresPicker()).toEqual([]);
  });
});
