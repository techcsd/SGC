import { Injectable, signal, computed, effect, inject } from '@angular/core';
import { UserService } from '../../app/core/services/user.service';

/**
 * W7 — estado GLOBAL de "Ver datos de prueba" para el admin (patrón Stripe).
 * Un solo interruptor gobierna TODAS las listas marcables (vehículos, combustible,
 * checklists, rutas, entradas, salidas, etc.): cada página lee/escribe esta misma
 * señal (`ver`), así que un toggle en cualquier lista o en el shell mueve todas y
 * el banner persistente del shell refleja el estado. Se persiste en sessionStorage
 * (vía effect) para sobrevivir la navegación.
 *
 * Nota: el ocultamiento real a no-admin es server-side (RLS restrictiva); esto es
 * solo la preferencia de visualización del admin.
 *
 * AE1 — filtro CENTRAL contra la fuga recurrente de datos de prueba (3ª vez: Z3/AD1/AE1).
 * Toda lista o KPI marcable debe derivar su base de `verPrueba()` / `visibles()` en vez
 * de re-implementar `esAdmin() && mostrarPrueba()` a mano (que es lo que se olvida y
 * causa las fugas). Ver `docs/DATOS-PRUEBA-AUDITORIA.md`.
 */
const STORAGE_KEY = 'sgc.verDatosPrueba';

interface ConEsPrueba {
  es_prueba?: boolean | null;
}

@Injectable({ providedIn: 'root' })
export class DatosPruebaViewService {
  private userService = inject(UserService);

  /** ¿El admin quiere ver los datos de prueba ahora mismo? (WritableSignal compartido) */
  readonly ver = signal<boolean>(this.leerInicial());

  /**
   * ¿Se deben MOSTRAR los datos de prueba en este momento? Solo si el usuario es admin
   * Y activó el interruptor. Fuente única de verdad — úsala en vez de recalcular
   * `esAdmin() && mostrarPrueba()` en cada página.
   */
  readonly verPrueba = computed(() => this.userService.hasRole('admin') && this.ver());

  /**
   * ¿Este usuario PUEDE ver datos de prueba (independiente del interruptor)? Úsalo para
   * decidir si mostrar el aviso "N de prueba ocultos — mostrar" en estados vacíos (AZ3):
   * a un no-admin ni le ofrecemos el toggle (RLS ya no le manda esas filas).
   */
  readonly puedeVerPrueba = computed(() => this.userService.hasRole('admin'));

  /**
   * Filtro CENTRAL de datos de prueba para KPIs/listas en memoria. Devuelve solo los
   * elementos visibles según `verPrueba()`. Reactivo: llamarlo dentro de un `computed`
   * lo re-evalúa cuando cambia el interruptor. Cualquier entidad con `es_prueba` (los
   * 24 tipos de Z5/AA21) debe pasar por aquí antes de contarse/sumarse.
   *
   * Para filas SIN columna `es_prueba` (asistencia, ausencias…), filtra por el padre:
   * `visibles(empleados).map(e => e.id)` → excluye sus hijos.
   */
  visibles<T extends ConEsPrueba>(items: readonly T[] | null | undefined): T[] {
    if (!items) return [];
    if (this.verPrueba()) return [...items];
    return items.filter((x) => !x?.es_prueba);
  }

  constructor() {
    // Cualquier `.set()` (desde una lista o el shell) persiste automáticamente.
    effect(() => {
      const v = this.ver();
      try {
        if (v) sessionStorage.setItem(STORAGE_KEY, '1');
        else sessionStorage.removeItem(STORAGE_KEY);
      } catch {
        /* modo privado / sin storage: se mantiene solo en memoria */
      }
    });
  }

  private leerInicial(): boolean {
    try {
      return sessionStorage.getItem(STORAGE_KEY) === '1';
    } catch {
      return false;
    }
  }

  set(valor: boolean): void {
    this.ver.set(valor);
  }

  toggle(): void {
    this.ver.set(!this.ver());
  }
}
