// DN-29 (ronda DN2) — "requieren atención" (mantenimiento/baja) vs el resto
// no se solapan.
import { TestBed } from '@angular/core/testing';
import { describe, it, expect } from 'vitest';
import { RrhhActivos } from './activos';
import { RrhhAdministracionService } from '../../../../shared/services/rrhh-administracion.service';
import { ToastService } from '../../../../shared/services/toast.service';
import { RrhhActivo } from '../../../../shared/models/rrhh-administracion.model';

function activo(overrides: Partial<RrhhActivo>): RrhhActivo {
  return {
    id: 'x', nombre: 'A', categoria: 'mobiliario', ubicacion: null, estado: 'bueno',
    fecha_adquisicion: null, valor: null, proximo_mantenimiento: null, notas: null,
    es_prueba: false, created_at: '', ...overrides,
  };
}

describe('RrhhActivos', () => {
  it('separa mantenimiento/baja del resto, sin solapar', async () => {
    TestBed.configureTestingModule({
      imports: [RrhhActivos],
      providers: [
        {
          provide: RrhhAdministracionService,
          useValue: {
            listarActivos: async () => [
              activo({ id: 'm1', estado: 'mantenimiento' }),
              activo({ id: 'b1', estado: 'baja' }),
              activo({ id: 'g1', estado: 'bueno' }),
            ],
          },
        },
        { provide: ToastService, useValue: { error: () => {} } },
      ],
    });
    const comp = TestBed.createComponent(RrhhActivos).componentInstance;
    await comp.ngOnInit();

    expect(comp.requierenAtencion().map((a) => a.id).sort()).toEqual(['b1', 'm1']);
    expect(comp.resto().map((a) => a.id)).toEqual(['g1']);
  });
});
