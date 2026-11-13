import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { EmpleadosService } from '../../../../shared/services/empleados.service';
import { RrhhOrganigramaNodo } from '../../../../shared/models/empleado.model';
import { ToastService } from '../../../../shared/services/toast.service';

interface NodoConNivel extends RrhhOrganigramaNodo {
  nivel: number;
}

/** DO-04 — mismo nodo que `arbol()`, pero anidado (hijos de verdad) para el
 *  marcado semántico del template; no reimplementa el agrupado por jefe_id. */
interface NodoArbol extends NodoConNivel {
  hijos: NodoArbol[];
}

/** DN-27 (P1) — Organigrama: usa jefe_id/cargo YA existentes en sgc.empleados
 *  (sgc.rrhh_organigrama(), no sensible — mismo permiso que Empleados/Asistencia). */
@Component({
  selector: 'app-rrhh-organigrama',
  imports: [NgTemplateOutlet],
  templateUrl: './organigrama.html',
  styleUrl: './organigrama.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RrhhOrganigrama implements OnInit {
  private svc = inject(EmpleadosService);
  private toast = inject(ToastService);

  nodos = signal<RrhhOrganigramaNodo[]>([]);
  cargando = signal(true);

  /** Aplana el árbol (raíces primero, cada jefe seguido de sus reportes) con
   *  un `nivel` de profundidad para la indentación — sin plantilla recursiva. */
  arbol = computed<NodoConNivel[]>(() => {
    const todos = this.nodos();
    const porJefe = new Map<string | null, RrhhOrganigramaNodo[]>();
    for (const n of todos) {
      const key = n.jefe_id && todos.some((x) => x.id === n.jefe_id) ? n.jefe_id : null;
      if (!porJefe.has(key)) porJefe.set(key, []);
      porJefe.get(key)!.push(n);
    }
    const salida: NodoConNivel[] = [];
    const visitados = new Set<string>();
    const visitar = (jefeId: string | null, nivel: number) => {
      for (const n of porJefe.get(jefeId) ?? []) {
        if (visitados.has(n.id)) continue; // defensivo: evita ciclo jefe_id accidental
        visitados.add(n.id);
        salida.push({ ...n, nivel });
        visitar(n.id, nivel + 1);
      }
    };
    visitar(null, 0);
    // Defensivo: un ciclo de jefe_id (A reporta a B, B reporta a A) deja ambos
    // sin raíz alcanzable desde null -- se agregan como raíz igual, en vez de
    // desaparecer en silencio del organigrama.
    for (const n of todos) {
      if (!visitados.has(n.id)) { visitados.add(n.id); salida.push({ ...n, nivel: 0 }); }
    }
    return salida;
  });

  sinJefeAsignado = computed(() => this.arbol().length < this.nodos().length);

  /** DO-04 — reconstruye la jerarquía real (hijos anidados) a partir del
   *  recorrido preorden de `arbol()` — no reimplementa el agrupado por jefe_id,
   *  solo reacomoda la misma salida para el marcado anidado del template. */
  raices = computed<NodoArbol[]>(() => {
    const plano = this.arbol();
    const raices: NodoArbol[] = [];
    const pila: NodoArbol[] = [];
    for (const n of plano) {
      const nodo: NodoArbol = { ...n, hijos: [] };
      pila.length = nodo.nivel;
      const padre = pila[nodo.nivel - 1] ?? null;
      if (padre) padre.hijos.push(nodo);
      else raices.push(nodo);
      pila[nodo.nivel] = nodo;
    }
    return raices;
  });

  async ngOnInit() {
    this.cargando.set(true);
    try {
      this.nodos.set(await this.svc.organigrama());
    } catch (e) {
      this.toast.error('No se pudo cargar el organigrama', e instanceof Error ? e.message : undefined);
    } finally {
      this.cargando.set(false);
    }
  }
}
