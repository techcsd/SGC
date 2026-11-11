// DN-29 (ronda DN2) — el toggle de "mostrar inactivos" filtra correctamente.
import { TestBed } from '@angular/core/testing';
import { describe, it, expect } from 'vitest';
import { RrhhProveedores } from './proveedores';
import { RrhhAdministracionService } from '../../../../shared/services/rrhh-administracion.service';
import { ToastService } from '../../../../shared/services/toast.service';
import { RrhhProveedorAdmin } from '../../../../shared/models/rrhh-administracion.model';

function proveedor(overrides: Partial<RrhhProveedorAdmin>): RrhhProveedorAdmin {
  return {
    id: 'x', nombre: 'P', servicio: null, contacto_nombre: null, contacto_telefono: null,
    contacto_email: null, contrato_desde: null, contrato_hasta: null, monto_mensual: null,
    notas: null, activo: true, es_prueba: false, created_at: '', ...overrides,
  };
}

describe('RrhhProveedores', () => {
  it('oculta inactivos por defecto, los muestra al activar el toggle', async () => {
    TestBed.configureTestingModule({
      imports: [RrhhProveedores],
      providers: [
        {
          provide: RrhhAdministracionService,
          useValue: { listarProveedoresAdmin: async () => [proveedor({ id: 'a', activo: true }), proveedor({ id: 'b', activo: false })] },
        },
        { provide: ToastService, useValue: { error: () => {} } },
      ],
    });
    const comp = TestBed.createComponent(RrhhProveedores).componentInstance;
    await comp.ngOnInit();

    expect(comp.visibles().map((p) => p.id)).toEqual(['a']);
    comp.mostrarInactivos.set(true);
    expect(comp.visibles().map((p) => p.id).sort()).toEqual(['a', 'b']);
  });
});
