import { describe, it, expect, vi } from 'vitest';
import { Injector } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';
import { PlantillasDocumentoService } from './plantillas-documento.service';

function crear(rpcResult: { error: { message: string } | null }) {
  const plantilla = { id: 'p1', nombre: 'Nueva' };
  const single = vi.fn().mockResolvedValue({ data: plantilla, error: null });
  const select = vi.fn(() => ({ single }));
  const eq = vi.fn(() => ({ select }));
  const update = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ update }));
  const rpc = vi.fn().mockResolvedValue(rpcResult);
  const fake = { client: { rpc, from } };
  const inj = Injector.create({
    providers: [
      { provide: SupabaseService, useValue: fake },
      { provide: PlantillasDocumentoService, useClass: PlantillasDocumentoService, deps: [] },
    ],
  });
  return { svc: inj.get(PlantillasDocumentoService), rpc, update, plantilla };
}

const cambios = { nombre: 'Nueva', categoria: 'otro' as never, contenido_html: '<p>x</p>', campos: [] };

describe('PlantillasDocumentoService.editarPlantilla', () => {
  it('si falla el snapshot de versión, no aplica los cambios', async () => {
    const { svc, update } = crear({ error: { message: 'No autorizado' } });
    await expect(svc.editarPlantilla('p1', cambios)).rejects.toThrow('No autorizado');
    expect(update).not.toHaveBeenCalled();
  });

  it('con snapshot correcto, aplica los cambios y devuelve la plantilla', async () => {
    const { svc, rpc, update, plantilla } = crear({ error: null });
    const res = await svc.editarPlantilla('p1', cambios, 'Ajuste');
    expect(rpc).toHaveBeenCalledWith('guardar_plantilla_version', { p_plantilla: 'p1', p_motivo: 'Ajuste' });
    expect(update).toHaveBeenCalled();
    expect(res).toEqual(plantilla);
  });
});
