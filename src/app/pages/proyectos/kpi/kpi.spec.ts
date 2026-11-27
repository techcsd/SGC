// Barrido proyectos (agente) — BS2/regla 16: el Ranking de Encargados no debe
// mostrar el error técnico crudo; lo presenta `app-error-state` por rol.
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { describe, it, expect, beforeEach } from 'vitest';
import { Kpi } from './kpi';
import { ProyectosService } from '../../../../shared/services/proyectos.service';
import { UserService } from '../../../core/services/user.service';
import { TelemetryService } from '../../../../shared/services/telemetry.service';
import { SupabaseService } from '../../../core/services/supabase.service';

describe('Kpi (Ranking de Encargados) — error por rol', () => {
  beforeEach(() => {
    const fakeService: Partial<ProyectosService> = {
      getKpiProyectos: async () => {
        throw Object.assign(new Error('permission denied for schema sgc'), { code: '42501' });
      },
    };
    TestBed.configureTestingModule({
      imports: [Kpi],
      providers: [
        provideRouter([]),
        { provide: ProyectosService, useValue: fakeService },
        { provide: UserService, useValue: { esDesarrollador: signal(false), roles: signal(['ingeniero']) } },
        { provide: TelemetryService, useValue: { reportCaught: () => {} } },
        { provide: SupabaseService, useValue: { client: { rpc: async () => ({ data: null, error: null }) } } },
      ],
    });
  });

  it('no muestra el mensaje técnico crudo, sí el mensaje por rol', async () => {
    const fixture = TestBed.createComponent(Kpi);
    await fixture.componentInstance.ngOnInit();
    fixture.detectChanges();
    const texto = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(texto).not.toContain('permission denied');
    expect(texto).toContain('Tu rol no tiene acceso a esta información.');
  });
});
