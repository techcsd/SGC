import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { UserService } from '../services/user.service';

/**
 * AV2 — Guard por rol: solo entra quien tenga AL MENOS uno de los roles indicados
 * (por roles.codigo). Defensa en profundidad para vistas de rol específico (p. ej.
 * "Mi rendimiento" = Chofer + Jefe de flota): el gate de menú ya la oculta, y este
 * guard impide llegar por URL directa. El admin NO entra salvo que se incluya 'admin'.
 */
export const rolesGuard = (...roles: string[]): CanActivateFn => {
  return () => {
    const userService = inject(UserService);
    const router = inject(Router);

    if (roles.some((r) => userService.hasRole(r))) {
      return true;
    }

    return router.createUrlTree(['/403']);
  };
};
