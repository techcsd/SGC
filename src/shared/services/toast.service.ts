import { Injectable, signal } from '@angular/core';

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
  error(titulo: string, mensaje?: string) {
    return this.show(titulo, { tipo: 'error', mensaje, durationMs: 9000 });
  }

  dismiss(id: number) {
    this._toasts.update((list) => list.filter((t) => t.id !== id));
  }
}
