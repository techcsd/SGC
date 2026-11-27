// Barrido proyectos (agente) — BS2/regla 16: el reporte de costo de material no
// debe mostrar el error técnico crudo; lo presenta `app-error-state` por rol.
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { describe, it, expect, beforeEach } from 'vitest';
import { ProyectoCostos } from './costos';
import { ProyectosService } from '../../../../shared/services/proyectos.service';
import { UserService } from '../../../core/services/user.service';
import { TelemetryService } from '../../../../shared/services/telemetry.service';
import { SupabaseService } from '../../../core/services/supabase.service';

describe('ProyectoCostos — error por rol', () => {
  beforeEach(() => {
    const fakeService: Partial<ProyectosService> = {
      getById: async () => {
        throw new Error('sin proyecto');
      },
      getCostoMaterialObra: async () => {
        throw new Error('PGRST202 Could not find the function sgc.costo_material_obra');
      },
    };
    TestBed.configureTestingModule({
      imports: [ProyectoCostos],
      providers: [
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: { get: () => 'p1' } } } },
        { provide: ProyectosService, useValue: fakeService },
        { provide: UserService, useValue: { esDesarrollador: signal(false), roles: signal(['ingeniero']) } },
        { provide: TelemetryService, useValue: { reportCaught: () => {} } },
        { provide: SupabaseService, useValue: { client: { rpc: async () => ({ data: null, error: null }) } } },
      ],
    });
  });

  it('no muestra el mensaje técnico crudo, sí el mensaje humano', async () => {
    const fixture = TestBed.createComponent(ProyectoCostos);
    fixture.detectChanges(); // dispara ngOnInit (carga que falla)
    await fixture.whenStable();
    fixture.detectChanges();
    const texto = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(texto).not.toContain('PGRST202');
    expect(texto).toContain('No pudimos cargar el costo de material');
  });
});
