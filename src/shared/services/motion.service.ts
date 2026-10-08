import { Injectable, signal } from '@angular/core';

/** CJ2/CJ3 — celebraciones "grandes" (overlay, ≤1.6s, se saltan tocando). */
export type CelebracionTipo = 'conduce' | 'ruta';
export interface CelebracionDatos {
  numero?: string | null;
  destino?: string | null;
  verUrl?: string | null;
  verLabel?: string | null;
}

@Injectable({ providedIn: 'root' })
export class MotionService {
  visible = signal(false);
  tipo = signal<CelebracionTipo>('conduce');
  datos = signal<CelebracionDatos>({});

  private timer: ReturnType<typeof setTimeout> | null = null;

  /** ¿el usuario/dispositivo pidió menos movimiento? → solo el check, sin la animación. */
  private reducido(): boolean {
    try {
      return (
        document.documentElement.classList.contains('motion-reduced') ||
        window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
      );
    } catch {
      return false;
    }
  }

  celebrar(tipo: CelebracionTipo, datos: CelebracionDatos = {}) {
    this.tipo.set(tipo);
    this.datos.set(datos);
    this.visible.set(true);
    if (this.timer) clearTimeout(this.timer);
    // El mensaje queda visible un momento tras la animación; luego se cierra solo.
    const dur = this.reducido() ? 1600 : 3600;
    this.timer = setTimeout(() => this.cerrar(), dur);
  }

  cerrar() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    this.visible.set(false);
  }
}
