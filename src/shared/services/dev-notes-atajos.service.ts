import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import { UserService } from '../../app/core/services/user.service';

/**
 * CQ2 — Ctrl+N (nota nueva) desde CUALQUIER pantalla del SGC, para Tecnología/
 * desarrolladores (misma matriz que gatea la ruta `/tecnologia/dev-notes`:
 * `desarrolladorGuard` → `UserService.esDesarrollador()`). No intercepta el
 * atajo si hay un campo de texto enfocado (no se quiere pisar Ctrl+N de otra
 * pantalla ni, aunque es poco común, el atajo nativo del navegador).
 *
 * `providedIn: 'root'` + instanciado una vez desde `app.ts` (inyectándolo en el
 * constructor) para registrar el listener global una sola vez por sesión.
 */
@Injectable({ providedIn: 'root' })
export class DevNotesAtajosService {
  private router = inject(Router);
  private userService = inject(UserService);

  constructor() {
    if (typeof document === 'undefined') return;
    document.addEventListener('keydown', this.onKeydown);
  }

  private onKeydown = (ev: KeyboardEvent) => {
    if (!(ev.ctrlKey || ev.metaKey) || ev.key.toLowerCase() !== 'n') return;

    const activo = document.activeElement as HTMLElement | null;
    const enCampo =
      !!activo &&
      (activo.tagName === 'INPUT' || activo.tagName === 'TEXTAREA' || activo.isContentEditable);
    if (enCampo) return;

    if (!this.userService.esDesarrollador()) return;

    ev.preventDefault();
    void this.router.navigate(['/tecnologia/dev-notes'], { queryParams: { nueva: 1 } });
  };
}
