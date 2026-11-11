// DN-29 (ronda DN) — un trámite nunca aparece en dos grupos a la vez
// (vencido / por-vencer-30d / resto son mutuamente excluyentes).
import { TestBed } from '@angular/core/testing';
import { describe, it, expect } from 'vitest';
import { RrhhTramites } from './tramites';
import { RrhhAdministracionService } from '../../../../shared/services/rrhh-administracion.service';
import { ToastService } from '../../../../shared/services/toast.service';
import { RrhhTramite } from '../../../../shared/models/rrhh-administracion.model';

function tramite(overrides: Partial<RrhhTramite>): RrhhTramite {
  return {
    id: 'x', nombre: 'T', tipo: 'permiso', entidad_responsable: null, numero_referencia: null,
    fecha_emision: null, fecha_vencimiento: null, archivo_path: null, estado: 'vigente',
    notas: null, creado_por: null, es_prueba: false, created_at: '', updated_at: '',
    ...overrides,
  };
}

function hoyMas(dias: number): string {
  const d = new Date(); d.setDate(d.getDate() + dias);
  return d.toISOString().slice(0, 10);
}

function crear(tramites: RrhhTramite[]) {
  TestBed.configureTestingModule({
    imports: [RrhhTramites],
    providers: [
      { provide: RrhhAdministracionService, useValue: { listarTramites: async () => tramites } },
      { provide: ToastService, useValue: { error: () => {}, success: () => {}, warning: () => {} } },
    ],
  });
  return TestBed.createComponent(RrhhTramites).componentInstance;
}

describe('RrhhTramites', () => {
  it('separa vencidos / por-vencer-30d / resto sin solaparse', async () => {
    const comp = crear([
      tramite({ id: 'v1', estado: 'vencido', fecha_vencimiento: hoyMas(-5) }),
      tramite({ id: 'p1', fecha_vencimiento: hoyMas(10) }),
      tramite({ id: 'r1', fecha_vencimiento: hoyMas(90) }),
      tramite({ id: 'r2', fecha_vencimiento: null }),
    ]);
    await comp.ngOnInit();

    expect(comp.vencidos().map((t) => t.id)).toEqual(['v1']);
    expect(comp.porVencer30d().map((t) => t.id)).toEqual(['p1']);
    expect(comp.resto().map((t) => t.id).sort()).toEqual(['r1', 'r2']);
  });
});
