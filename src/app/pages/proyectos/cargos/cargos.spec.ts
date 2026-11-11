// DN-24 (ronda DN) — clic en una fila del catálogo abre un panel de detalle
// (alias editables + cuántas personas tienen el cargo); eliminar un alias ya
// no usa confirm() nativo (regla 16).
import { TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach } from 'vitest';
import { ActivatedRoute } from '@angular/router';
import { ProyectosCargos } from './cargos';
import { PersonalObraService, CargoAlias } from '../../../../shared/services/personal-obra.service';
import { Cargo } from '../../../../shared/models/personal-obra.model';
import { ToastService } from '../../../../shared/services/toast.service';

const CARGO: Cargo = { id: 'c1', codigo: 'CAP', nombre: 'Capataz', activo: true, orden: 1 };
const ALIAS: CargoAlias = { id: 'a1', alias_normalizado: 'CAPATAZ CSD', cargo_id: 'c1', cargo_codigo: 'CAP', cargo_nombre: 'Capataz', created_at: new Date().toISOString() };

describe('ProyectosCargos', () => {
  let eliminados: string[];

  beforeEach(() => {
    eliminados = [];
    const fakeService: Partial<PersonalObraService> = {
      getCargos: async () => [CARGO],
      listarCargoAlias: async () => [ALIAS],
      contarPersonalPorCargo: async (id: string) => (id === 'c1' ? 7 : 0),
      eliminarCargoAlias: async (id: string) => { eliminados.push(id); },
    };
    TestBed.configureTestingModule({
      imports: [ProyectosCargos],
      providers: [
        { provide: PersonalObraService, useValue: fakeService },
        { provide: ToastService, useValue: { error: () => {}, success: () => {}, warning: () => {} } },
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: { get: () => null } } } },
      ],
    });
  });

  it('DN-24: abrirDetalle selecciona el cargo y cuenta sus personas', async () => {
    const fixture = TestBed.createComponent(ProyectosCargos);
    const comp = fixture.componentInstance;
    await comp.ngOnInit();

    expect(comp.seleccionado()).toBeNull();
    comp.abrirDetalle(CARGO);
    await Promise.resolve();
    await Promise.resolve();

    expect(comp.seleccionado()?.id).toBe('c1');
    expect(comp.personasDelCargo()).toBe(7);
    expect(comp.aliasesDelSeleccionado().map((a) => a.id)).toEqual(['a1']);
  });

  it('DN-24: cerrarDetalle limpia la selección', async () => {
    const fixture = TestBed.createComponent(ProyectosCargos);
    const comp = fixture.componentInstance;
    await comp.ngOnInit();
    comp.abrirDetalle(CARGO);
    comp.cerrarDetalle();

    expect(comp.seleccionado()).toBeNull();
    expect(comp.personasDelCargo()).toBeNull();
  });

  it('DN-25/regla16: eliminar un alias NO borra directo -- pide confirmación propia primero', async () => {
    const fixture = TestBed.createComponent(ProyectosCargos);
    const comp = fixture.componentInstance;
    await comp.ngOnInit();

    comp.eliminarAlias(ALIAS);
    expect(eliminados).toEqual([]); // todavía no se borró
    expect(comp.aliasAEliminar()?.id).toBe('a1');

    await comp.confirmarEliminarAlias();
    expect(eliminados).toEqual(['a1']);
    expect(comp.aliasAEliminar()).toBeNull();
  });
});
