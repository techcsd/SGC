import { Injectable, signal } from '@angular/core';

/** CJ2/CJ3 — celebraciones "grandes" (overlay, ≤1.6s, se saltan tocando). */
export type CelebracionTipo = 'conduce' | 'ruta';
export interface CelebracionDatos {
  numero?: string | null;
  destino?: string | null;
  verUrl?: string | null;
  verLabel?: string | null;
}

/** CL2 — momentos "medianos" (~0.8s, SIN velo, no bloquean, aria-live). Uno por
 *  acción de éxito. Sin celebración en accidente/multa/rechazo/eliminar/error/
 *  retiro dañado (esos solo llevan el aviso sobrio). */
export type MomentoTipo =
  | 'entrada' | 'salida' | 'aprobado' | 'firma' | 'combustible'
  | 'checklist' | 'mantenimiento' | 'mensaje' | 'documento';
export interface MomentoDatos {
  texto?: string | null;
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

  // ── CL2 — momentos medianos (0.8s, sin velo) ──────────────────────────────────
  momentoVisible = signal(false);
  momentoTipo = signal<MomentoTipo>('entrada');
  momentoDatos = signal<MomentoDatos>({});
  private momentoTimer: ReturnType<typeof setTimeout> | null = null;

  /** Dispara un momento mediano. No bloquea; se cierra solo (~1.4s con texto). */
  momento(tipo: MomentoTipo, datos: MomentoDatos = {}) {
    this.momentoTipo.set(tipo);
    this.momentoDatos.set(datos);
    this.momentoVisible.set(true);
    if (this.momentoTimer) clearTimeout(this.momentoTimer);
    const dur = this.reducido() ? 900 : 1400;
    this.momentoTimer = setTimeout(() => this.momentoVisible.set(false), dur);
  }
}
