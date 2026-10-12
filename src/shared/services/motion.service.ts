import { Injectable, signal } from '@angular/core';

/** CL2 — momentos "medianos" (~0.8s, SIN velo, no bloquean, aria-live). Uno por
 *  acción de éxito. Sin celebración en accidente/multa/rechazo/eliminar/error/
 *  retiro dañado (esos solo llevan el aviso sobrio). */
export type MomentoTipo =
  | 'entrada' | 'salida' | 'aprobado' | 'firma' | 'combustible'
  | 'checklist' | 'mantenimiento' | 'mensaje' | 'documento' | 'uso';
export interface MomentoDatos {
  texto?: string | null;
  sub?: string | null;
}

/** CN5 — tipos que tienen escena a pantalla completa (mock `Escena.dc.html`). */
const ESCENA_TIPOS: readonly MomentoTipo[] = [
  'entrada', 'salida', 'aprobado', 'firma', 'combustible',
  'checklist', 'mantenimiento', 'mensaje', 'documento', 'uso',
];

/** CJ2/CJ3/CN5 — celebraciones "grandes" (overlay). conduce=CJ2, ruta=CJ3, y los
 *  tipos de momento como escenas a pantalla completa (CN5). */
export type CelebracionTipo = 'conduce' | 'ruta' | MomentoTipo;
export interface CelebracionDatos {
  numero?: string | null;
  destino?: string | null;
  verUrl?: string | null;
  verLabel?: string | null;
  texto?: string | null;
  sub?: string | null;
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

  /** Momento del último overlay grande (celebración o escena); gobierna la ráfaga. */
  private lastEscenaAt = 0;

  /** ¿`tipo` es una escena de momento (CN5) y no conduce/ruta? */
  esEscena(tipo: CelebracionTipo): boolean {
    return (ESCENA_TIPOS as readonly string[]).includes(tipo);
  }

  celebrar(tipo: CelebracionTipo, datos: CelebracionDatos = {}) {
    this.lastEscenaAt = Date.now();
    this.tipo.set(tipo);
    this.datos.set(datos);
    this.visible.set(true);
    if (this.timer) clearTimeout(this.timer);
    // CN5 — escena de momento = 1,8s (1s reducido); conduce/ruta mantienen su tiempo.
    const dur = this.esEscena(tipo)
      ? (this.reducido() ? 1000 : 1800)
      : (this.reducido() ? 1600 : 3600);
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

  /**
   * CN5 — dispara el momento de una acción de éxito. Por defecto sale como **escena a
   * pantalla completa** (mock `Escena.dc.html`); pero si hubo otra escena/celebración en
   * los últimos 10s (ráfaga), sale en la **versión corta** (tarjeta mediana, sin velo)
   * para no encadenar velos. Lotes = el que llama pasa el total en `datos.sub`.
   */
  momento(tipo: MomentoTipo, datos: MomentoDatos = {}) {
    const rafaga = Date.now() - this.lastEscenaAt < 10000;
    if (!rafaga) {
      // Escena a pantalla completa (reutiliza el overlay grande con el tipo de momento).
      this.celebrar(tipo, { texto: datos.texto, sub: datos.sub });
      return;
    }
    // Ráfaga → tarjeta corta mediana (la de siempre).
    this.momentoTipo.set(tipo);
    this.momentoDatos.set(datos);
    this.momentoVisible.set(true);
    if (this.momentoTimer) clearTimeout(this.momentoTimer);
    const dur = this.reducido() ? 900 : 1400;
    this.momentoTimer = setTimeout(() => this.momentoVisible.set(false), dur);
  }
}
