// DN-27 (ronda DN3) — avanzar/rechazar mueve al candidato de etapa; contratado
// y rechazado son terminales (ya no se puede avanzar más).
import { TestBed } from '@angular/core/testing';
import { describe, it, expect } from 'vitest';
import { RrhhOnboarding } from './onboarding';
import { RrhhOnboardingService } from '../../../../shared/services/rrhh-onboarding.service';
import { ToastService } from '../../../../shared/services/toast.service';
import { RrhhCandidato, RrhhVacante } from '../../../../shared/models/rrhh-onboarding.model';

const VACANTE: RrhhVacante = { id: 'v1', titulo: 'Ayudante', departamento: null, descripcion: null, estado: 'abierta', creado_por: null, created_at: '' };

function candidato(overrides: Partial<RrhhCandidato>): RrhhCandidato {
  return {
    id: 'c1', vacante_id: 'v1', nombre: 'Juan', telefono: null, email: null, cv_path: null,
    etapa: 'aplicado', notas: null, empleado_id: null, creado_por: null, created_at: '', updated_at: '',
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
      ],
    });
    const comp = TestBed.createComponent(RrhhOnboarding).componentInstance;
    await comp.ngOnInit();
    await comp.seleccionarVacante(VACANTE);

    await comp.rechazar(candidato({ etapa: 'entrevista' }));
    expect(cambios).toEqual(['rechazado']);
  });
});
