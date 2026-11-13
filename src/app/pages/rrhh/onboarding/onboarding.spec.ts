// DN-27 (ronda DN3) — avanzar/rechazar mueve al candidato de etapa; contratado
// y rechazado son terminales (ya no se puede avanzar más).
import { TestBed } from '@angular/core/testing';
import { describe, it, expect } from 'vitest';
import { RrhhOnboarding } from './onboarding';
import { RrhhOnboardingService } from '../../../../shared/services/rrhh-onboarding.service';
import { ToastService } from '../../../../shared/services/toast.service';
import { UserService } from '../../../core/services/user.service';
import { RrhhCandidato, RrhhVacante } from '../../../../shared/models/rrhh-onboarding.model';

const fakeUserService = { profile: () => ({ id: 'u1' }) };

const VACANTE: RrhhVacante = { id: 'v1', titulo: 'Ayudante', departamento: null, descripcion: null, estado: 'abierta', creado_por: null, created_at: '' };

function candidato(overrides: Partial<RrhhCandidato>): RrhhCandidato {
  return {
    id: 'c1', vacante_id: 'v1', nombre: 'Juan', telefono: null, email: null, cv_path: null,
    etapa: 'aplicado', notas: null, empleado_id: null, creado_por: null, created_at: '', updated_at: '',
    experiencia_resumen: null, educacion: null, expectativa_salarial: null, fuente: null, telefono_alterno: null,
    cv_extraido: null, archivado: false, archivado_en: null, archivado_por: null,
    ...overrides,
  };
}

describe('RrhhOnboarding', () => {
  it('avanzarEtapa mueve aplicado -> entrevista -> oferta, nunca salta a contratado solo', async () => {
    const cambios: string[] = [];
    TestBed.configureTestingModule({
      imports: [RrhhOnboarding],
      providers: [
        {
          provide: RrhhOnboardingService,
          useValue: {
            listarVacantes: async () => [VACANTE],
            listarCandidatos: async () => [candidato({ etapa: 'aplicado' })],
            cambiarEtapa: async (_id: string, etapa: string) => { cambios.push(etapa); },
          },
        },
        { provide: ToastService, useValue: { error: () => {}, success: () => {}, warning: () => {} } },
        { provide: UserService, useValue: fakeUserService },
      ],
    });
    const comp = TestBed.createComponent(RrhhOnboarding).componentInstance;
    await comp.ngOnInit();
    await comp.seleccionarVacante(VACANTE);

    await comp.avanzarEtapa(candidato({ etapa: 'aplicado' }));
    expect(cambios).toEqual(['entrevista']);
  });

  it('avanzarEtapa en "oferta" avanza a "contratado" (último paso positivo)', async () => {
    const cambios: string[] = [];
    TestBed.configureTestingModule({
      imports: [RrhhOnboarding],
      providers: [
        {
          provide: RrhhOnboardingService,
          useValue: {
            listarVacantes: async () => [VACANTE],
            listarCandidatos: async () => [],
            cambiarEtapa: async (_id: string, etapa: string) => { cambios.push(etapa); },
          },
        },
        { provide: ToastService, useValue: { error: () => {}, success: () => {}, warning: () => {} } },
        { provide: UserService, useValue: fakeUserService },
      ],
    });
    const comp = TestBed.createComponent(RrhhOnboarding).componentInstance;
    await comp.ngOnInit();
    await comp.seleccionarVacante(VACANTE);

    await comp.avanzarEtapa(candidato({ etapa: 'oferta' }));
    expect(cambios).toEqual(['contratado']);
  });

  it('avanzarEtapa en "contratado" no hace nada (terminal, nunca salta a rechazado)', async () => {
    const cambios: string[] = [];
    TestBed.configureTestingModule({
      imports: [RrhhOnboarding],
      providers: [
        {
          provide: RrhhOnboardingService,
          useValue: {
            listarVacantes: async () => [VACANTE],
            listarCandidatos: async () => [],
            cambiarEtapa: async (_id: string, etapa: string) => { cambios.push(etapa); },
          },
        },
        { provide: ToastService, useValue: { error: () => {}, success: () => {}, warning: () => {} } },
        { provide: UserService, useValue: fakeUserService },
      ],
    });
    const comp = TestBed.createComponent(RrhhOnboarding).componentInstance;
    await comp.ngOnInit();
    await comp.seleccionarVacante(VACANTE);

    await comp.avanzarEtapa(candidato({ etapa: 'contratado' }));
    expect(cambios).toEqual([]);
  });

  it('rechazar marca la etapa como rechazado desde cualquier punto', async () => {
    const cambios: string[] = [];
    TestBed.configureTestingModule({
      imports: [RrhhOnboarding],
      providers: [
        {
          provide: RrhhOnboardingService,
          useValue: {
            listarVacantes: async () => [VACANTE],
            listarCandidatos: async () => [],
            cambiarEtapa: async (_id: string, etapa: string) => { cambios.push(etapa); },
          },
        },
        { provide: ToastService, useValue: { error: () => {}, success: () => {}, warning: () => {} } },
        { provide: UserService, useValue: fakeUserService },
      ],
    });
    const comp = TestBed.createComponent(RrhhOnboarding).componentInstance;
    await comp.ngOnInit();
    await comp.seleccionarVacante(VACANTE);

    await comp.rechazar(candidato({ etapa: 'entrevista' }));
    expect(cambios).toEqual(['rechazado']);
  });

  it('DO-07: "eliminar" desde el pipeline archiva (no borra físicamente)', async () => {
    const archivados: Array<{ id: string; usuarioId: string | null }> = [];
    let eliminadoFisico = false;
    TestBed.configureTestingModule({
      imports: [RrhhOnboarding],
      providers: [
        {
          provide: RrhhOnboardingService,
          useValue: {
            listarVacantes: async () => [VACANTE],
            listarCandidatos: async () => [],
            archivarCandidato: async (id: string, usuarioId: string | null) => { archivados.push({ id, usuarioId }); },
            eliminarCandidatoFisico: async () => { eliminadoFisico = true; },
          },
        },
        { provide: ToastService, useValue: { error: () => {}, success: () => {}, warning: () => {} } },
        { provide: UserService, useValue: fakeUserService },
      ],
    });
    const comp = TestBed.createComponent(RrhhOnboarding).componentInstance;
    await comp.ngOnInit();
    await comp.seleccionarVacante(VACANTE);

    comp.pedirEliminarCandidato(candidato({ id: 'c9' }));
    await comp.confirmarEliminarCandidato();

    expect(archivados).toEqual([{ id: 'c9', usuarioId: 'u1' }]);
    expect(eliminadoFisico).toBe(false);
  });
});
