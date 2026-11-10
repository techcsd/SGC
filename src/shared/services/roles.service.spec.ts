// DL-34 — RolesService.update debe fallar claro cuando RLS deja la fila sin
// tocar (0 filas): antes el editor seguía mostrando lo marcado aunque nada se
// hubiera guardado, porque `.update().eq(id)` sin `.select()` no reporta filas.
import { describe, it, expect } from 'vitest';
import { RolesService } from './roles.service';

function svcConUpdate(resultado: { data: unknown; error: unknown }): RolesService {
  const svc = Object.create(RolesService.prototype) as RolesService;
  const builder = {
    update: () => builder,
    eq: () => builder,
    select: () => builder,
    single: async () => resultado,
  };
  (svc as unknown as { supabase: unknown }).supabase = {
    client: { from: () => builder },
  };
  return svc;
}

const PAYLOAD = { nombre: 'Gerencia', modulos: ['proyectos'], permisos: { 'tecnologia.inventario': 'ver' as const } };

describe('RolesService.update (DL-34)', () => {
  it('lanza error claro cuando .single() no devuelve fila (RLS dejó 0 filas afectadas)', async () => {
    const svc = svcConUpdate({ data: null, error: { message: 'JSON object requested, multiple (or no) rows returned' } });
    await expect(svc.update(1, PAYLOAD)).rejects.toThrow('No se guardó');
  });

  it('lanza error claro cuando lo releído difiere de lo enviado', async () => {
    const svc = svcConUpdate({ data: { id: 1, modulos: [], permisos: {} }, error: null });
    await expect(svc.update(1, PAYLOAD)).rejects.toThrow('No se guardó');
  });

  it('devuelve la fila releída cuando coincide con lo enviado', async () => {
    const svc = svcConUpdate({ data: { id: 1, modulos: PAYLOAD.modulos, permisos: PAYLOAD.permisos }, error: null });
    await expect(svc.update(1, PAYLOAD)).resolves.toEqual({ id: 1, modulos: PAYLOAD.modulos, permisos: PAYLOAD.permisos });
  });
});
