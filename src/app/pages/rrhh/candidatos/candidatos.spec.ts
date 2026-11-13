// DO-05/DO-07 (ronda DO) — índice global de candidatos: búsqueda, tabs
// activos/archivados, edición de intake y el camino de archivar/restaurar/
// borrado físico (siempre detrás de confirmación explícita).
import { TestBed } from '@angular/core/testing';
import { describe, it, expect, vi } from 'vitest';
import { RrhhCandidatos } from './candidatos';
import { RrhhOnboardingService } from '../../../../shared/services/rrhh-onboarding.service';
import { RrhhCandidatosLectorService } from '../../../../shared/services/rrhh-candidatos-lector.service';
import { ToastService } from '../../../../shared/services/toast.service';
import { UserService } from '../../../core/services/user.service';
import { RrhhCandidatoConVacante, RrhhCandidatoCvExtraido } from '../../../../shared/models/rrhh-onboarding.model';

function candidato(overrides: Partial<RrhhCandidatoConVacante> = {}): RrhhCandidatoConVacante {
  return {
    id: 'c1', vacante_id: 'v1', vacante_titulo: 'Ayudante', nombre: 'Juan Pérez', telefono: null,
    telefono_alterno: null, email: null, cv_path: null, etapa: 'aplicado', notas: null, empleado_id: null,
    creado_por: null, created_at: '', updated_at: '', experiencia_resumen: null, educacion: null,
    expectativa_salarial: null, fuente: null, cv_extraido: null, archivado: false, archivado_en: null,
    archivado_por: null,
    ...overrides,
  };
}

function crear(
  candidatos: RrhhCandidatoConVacante[],
  overrides: Partial<RrhhOnboardingService> = {},
  lectorOverrides: Partial<RrhhCandidatosLectorService> = {},
) {
  const calls: Record<string, unknown[]> = {};
  const record = (name: string) => (...args: unknown[]) => { (calls[name] ??= []).push(args); };
  TestBed.configureTestingModule({
    imports: [RrhhCandidatos],
    providers: [
      {
        provide: RrhhOnboardingService,
        useValue: {
          listarCandidatosGlobal: async () => candidatos,
          archivarCandidato: record('archivarCandidato'),
          restaurarCandidato: record('restaurarCandidato'),
          eliminarCandidatoFisico: record('eliminarCandidatoFisico'),
          actualizarCandidato: record('actualizarCandidato'),
          cambiarEtapa: record('cambiarEtapa'),
          getCvUrl: async () => 'https://signed.example/cv.pdf',
          ...overrides,
        },
      },
      {
        provide: RrhhCandidatosLectorService,
        useValue: {
          archivoABase64: async () => 'QkFTRTY0',
          leer: record('leer'),
          ...lectorOverrides,
        },
      },
      { provide: ToastService, useValue: { error: () => {}, success: () => {}, warning: () => {} } },
      { provide: UserService, useValue: { profile: () => ({ id: 'u1' }) } },
    ],
  });
  const comp = TestBed.createComponent(RrhhCandidatos).componentInstance;
  return { comp, calls };
}

describe('RrhhCandidatos', () => {
  it('filtrados() separa activos de archivados por tab', async () => {
    const { comp } = crear([
      candidato({ id: 'activo', archivado: false }),
      candidato({ id: 'archivado', archivado: true }),
    ]);
    await comp.ngOnInit();

    expect(comp.filtrados().map((c) => c.id)).toEqual(['activo']);
    comp.tab.set('archivados');
    expect(comp.filtrados().map((c) => c.id)).toEqual(['archivado']);
  });

  it('filtrados() busca por nombre, email, teléfono y vacante', async () => {
    const { comp } = crear([
      candidato({ id: 'a', nombre: 'María Soto', vacante_titulo: 'Capataz' }),
      candidato({ id: 'b', nombre: 'Pedro Luna', vacante_titulo: 'Ayudante', email: 'pedro@x.com' }),
    ]);
    await comp.ngOnInit();

    comp.query.set('capataz');
    expect(comp.filtrados().map((c) => c.id)).toEqual(['a']);
    comp.query.set('pedro@x.com');
    expect(comp.filtrados().map((c) => c.id)).toEqual(['b']);
  });

  it('pedirArchivar + confirmarArchivar llama archivarCandidato con el usuario actual', async () => {
    const { comp, calls } = crear([candidato({ id: 'c1' })]);
    await comp.ngOnInit();

    comp.pedirArchivar(candidato({ id: 'c1' }));
    await comp.confirmarArchivar();

    expect(calls['archivarCandidato']).toEqual([['c1', 'u1']]);
  });

  it('pedirEliminarFisico + confirmarEliminarFisico llama eliminarCandidatoFisico, no archivarCandidato', async () => {
    const { comp, calls } = crear([candidato({ id: 'c1', cv_path: 'candidatos/c1/cv.pdf' })]);
    await comp.ngOnInit();

    comp.pedirEliminarFisico(candidato({ id: 'c1', cv_path: 'candidatos/c1/cv.pdf' }));
    await comp.confirmarEliminarFisico();

    expect(calls['eliminarCandidatoFisico']).toEqual([['c1', 'candidatos/c1/cv.pdf']]);
    expect(calls['archivarCandidato']).toBeUndefined();
  });

  it('restaurar llama restaurarCandidato sin pasar por el diálogo de confirmación', async () => {
    const { comp, calls } = crear([candidato({ id: 'c1', archivado: true })]);
    await comp.ngOnInit();

    await comp.restaurar(candidato({ id: 'c1', archivado: true }));

    expect(calls['restaurarCandidato']).toEqual([['c1']]);
  });

  it('DO-06: leerCvConIa sube el CV ya guardado al lector y aplica el resultado al candidato', async () => {
    const extraido: RrhhCandidatoCvExtraido = {
      nombre: 'Juan Pérez', telefono: '809-555-1234', email: null,
      experiencia_resumen: 'Ayudante de carpintero', educacion: null, cargos_previos: ['Ayudante'],
    };
    const fetchMock = vi.fn(async () => ({ blob: async () => new Blob(['%PDF-1.4'], { type: 'application/pdf' }) }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      const { comp, calls } = crear(
        [candidato({ id: 'c1', cv_path: 'candidatos/c1/cv.pdf' })],
        {},
        { leer: async (id: string, archivo: { data: string; mime: string }) => { calls['leer'] = [[id, archivo]]; return extraido; } },
      );
      await comp.ngOnInit();
      comp.abrirDetalle(candidato({ id: 'c1', cv_path: 'candidatos/c1/cv.pdf' }));

      await comp.leerCvConIa();

      expect(fetchMock).toHaveBeenCalledWith('https://signed.example/cv.pdf');
      expect(comp.seleccionado()?.cv_extraido).toEqual(extraido);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('abrirDetalle precarga los campos editables desde el candidato', async () => {
    const { comp } = crear([candidato({ id: 'c1', nombre: 'Ana', expectativa_salarial: 25000 })]);
    await comp.ngOnInit();

    comp.abrirDetalle(candidato({ id: 'c1', nombre: 'Ana', expectativa_salarial: 25000 }));

    expect(comp.eNombre()).toBe('Ana');
    expect(comp.eExpectativa()).toBe('25000');
  });
});
