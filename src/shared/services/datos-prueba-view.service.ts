import { Injectable, signal, effect } from '@angular/core';

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
 */
const STORAGE_KEY = 'sgc.verDatosPrueba';

@Injectable({ providedIn: 'root' })
export class DatosPruebaViewService {
  /** ¿El admin quiere ver los datos de prueba ahora mismo? (WritableSignal compartido) */
  readonly ver = signal<boolean>(this.leerInicial());

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
