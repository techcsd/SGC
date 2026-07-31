import { Injectable, inject, signal } from '@angular/core';
import { humanizeError } from '../utils/friendly-error.util';
import { TelemetryService } from './telemetry.service';

export type ToastTipo = 'info' | 'success' | 'warning' | 'error';

export interface Toast {
  id: number;
  tipo: ToastTipo;
  titulo: string;
  mensaje?: string;
  /** Optional route to navigate to when the toast is clicked. */
  route?: string;
}

/** App-wide, signal-based toast queue. Rendered once by <app-toast> in the root. */
@Injectable({ providedIn: 'root' })
export class ToastService {
  private telemetry = inject(TelemetryService);
  private _toasts = signal<Toast[]>([]);
  toasts = this._toasts.asReadonly();

  // Date.now() is unavailable in some sandboxed contexts here; a simple counter
  // is enough for unique keys.
  private seq = 0;

  show(titulo: string, opts: { tipo?: ToastTipo; mensaje?: string; route?: string; durationMs?: number } = {}) {
    const id = ++this.seq;
    const toast: Toast = {
      id,
      tipo: opts.tipo ?? 'info',
      titulo,
      mensaje: opts.mensaje,
      route: opts.route,
    };
    this._toasts.update((list) => [...list, toast]);
    const duration = opts.durationMs ?? 6000;
    if (duration > 0) {
      setTimeout(() => this.dismiss(id), duration);
    }
    return id;
  }

  success(titulo: string, mensaje?: string, route?: string) {
    return this.show(titulo, { tipo: 'success', mensaje, route });
  }
  info(titulo: string, mensaje?: string, route?: string) {
    return this.show(titulo, { tipo: 'info', mensaje, route });
  }
  warning(titulo: string, mensaje?: string, route?: string) {
    return this.show(titulo, { tipo: 'warning', mensaje, route });
  }
  /**
   * AD1 — Muestra un error. Si `mensaje` es un error crudo de BD/red, se traduce
   * a un texto amable y el original se reporta a telemetría (una sola vez). Así,
   * los cientos de `toast.error('...', e.message)` existentes dejan de filtrar
   * jerga técnica a la UI sin tocar cada sitio.
   */
  error(titulo: string, mensaje?: string) {
    let texto = mensaje;
    if (mensaje != null && mensaje !== '') {
      const f = humanizeError(mensaje);
      texto = f.mensaje;
      if (f.technical) this.telemetry.reportCaught(f.raw, { titulo });
    }
    return this.show(titulo, { tipo: 'error', mensaje: texto, durationMs: 9000 });
  }

  /** Conveniencia: muestra un error a partir de un objeto de error cualquiera. */
  errorFrom(error: unknown, titulo = 'Ocurrió un error') {
    const f = humanizeError(error);
    if (f.technical) this.telemetry.reportCaught(f.raw, { titulo });
    return this.show(titulo, { tipo: 'error', mensaje: f.mensaje, durationMs: 9000 });
  }

  dismiss(id: number) {
    this._toasts.update((list) => list.filter((t) => t.id !== id));
  }
}
