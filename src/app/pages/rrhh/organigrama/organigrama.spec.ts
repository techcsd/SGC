// DN-27 (ronda DN) — el árbol del organigrama se aplana (sin plantilla
// recursiva) respetando niveles de jefatura, y no entra en ciclo si algún
// dato tiene jefe_id inconsistente (defensivo).
import { TestBed } from '@angular/core/testing';
import { describe, it, expect } from 'vitest';
import { RrhhOrganigrama } from './organigrama';
import { EmpleadosService } from '../../../../shared/services/empleados.service';
import { ToastService } from '../../../../shared/services/toast.service';
import { RrhhOrganigramaNodo } from '../../../../shared/models/empleado.model';

function nodo(overrides: Partial<RrhhOrganigramaNodo>): RrhhOrganigramaNodo {
  return { id: 'x', nombre: 'N', apellido: 'A', cargo: null, departamento: null, jefe_id: null, activo: true, ...overrides };
}

function crear(nodos: RrhhOrganigramaNodo[]) {
  TestBed.configureTestingModule({
    imports: [RrhhOrganigrama],
    providers: [
      { provide: EmpleadosService, useValue: { organigrama: async () => nodos } },
      { provide: ToastService, useValue: { error: () => {} } },
    ],
  });
  return TestBed.createComponent(RrhhOrganigrama).componentInstance;
}

describe('RrhhOrganigrama', () => {
  it('ordena jefe antes que su reporte, con nivel incremental', async () => {
    const comp = crear([
      nodo({ id: 'e1', nombre: 'Empleado', jefe_id: 'j1' }),
      nodo({ id: 'j1', nombre: 'Jefe' }),
    ]);
    await comp.ngOnInit();
    const arbol = comp.arbol();
    expect(arbol.map((n) => n.id)).toEqual(['j1', 'e1']);
    expect(arbol.find((n) => n.id === 'j1')!.nivel).toBe(0);
    expect(arbol.find((n) => n.id === 'e1')!.nivel).toBe(1);
  });

  it('jefe_id apuntando a alguien que no está en la lista se trata como raíz', async () => {
    const comp = crear([nodo({ id: 'e1', nombre: 'Huérfano', jefe_id: 'no-existe' })]);
    await comp.ngOnInit();
    expect(comp.arbol().map((n) => n.id)).toEqual(['e1']);
    expect(comp.arbol()[0].nivel).toBe(0);
  });

  it('un ciclo accidental de jefe_id no cuelga el cómputo (defensivo)', async () => {
    const comp = crear([
      nodo({ id: 'a', nombre: 'A', jefe_id: 'b' }),
      nodo({ id: 'b', nombre: 'B', jefe_id: 'a' }),
    ]);
    await comp.ngOnInit();
    expect(comp.arbol().length).toBe(2); // termina, no se cuelga
  });
});
