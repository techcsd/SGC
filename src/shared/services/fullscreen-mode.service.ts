import { Injectable, signal } from '@angular/core';

/**
 * CQ2 — Modo "pantalla completa" genérico: cuando una pantalla lo activa, el
 * shell (`shared/components/shell`) oculta su chrome (sidebar + header) para
 * dejar el contenido ocupando toda la ventana. Pensado para Dev notes (editor
 * inmersivo), reutilizable por cualquier otra pantalla futura que lo necesite
 * (p. ej. un visor a pantalla completa). Un único activador a la vez: la
 * pantalla que lo activó es responsable de desactivarlo al salir/destruirse.
 */
@Injectable({ providedIn: 'root' })
export class FullscreenModeService {
  private _activo = signal(false);
  activo = this._activo.asReadonly();

  activar(): void {
    this._activo.set(true);
  }

  desactivar(): void {
    this._activo.set(false);
  }
}
