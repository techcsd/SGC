import { Injectable, signal } from '@angular/core';

/**
 * CM2 — orquesta el "logo reveal" al entrar (una vez por sesión). `auth.ts` llama
 * `reproducir()` tras un login OK y navega a la vez; el componente montado en el root
 * se encarga del velo + la animación + el auto-cierre.
 */
const SESION_KEY = 'sgc_logo_reveal_sesion';

@Injectable({ providedIn: 'root' })
export class LogoRevealService {
  visible = signal(false);

  /** Muestra el reveal si no se mostró ya en esta sesión. */
  reproducir() {
    try { if (sessionStorage.getItem(SESION_KEY) === '1') return; sessionStorage.setItem(SESION_KEY, '1'); } catch { /* sin sessionStorage igual se muestra */ }
    this.visible.set(true);
  }
  cerrar() { this.visible.set(false); }
}
