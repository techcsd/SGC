import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { UserService } from '../services/user.service';
import { SUBMODULOS } from '../../../shared/services/roles.service';

/**
 * AN2 — Guard del "parent" de un módulo con submódulos granulares (Inventario,
 * Flota…). Deja pasar a quien tenga el MÓDULO completo (compat) O a quien pueda
 * VER al menos UN submódulo del módulo (rol granular de la auditoría). Cada ruta
 * hija afina el acceso con `submoduloGuard`. Espeja la visibilidad del menú
 * (`shell.canAccess`) para que la navegación directa por URL respete lo mismo.
 */
export const moduloOSubmoduloGuard = (modulo: string): CanActivateFn => {
  return () => {
    const userService = inject(UserService);
    const router = inject(Router);
    if (userService.hasModulo(modulo)) return true;
    const subs = SUBMODULOS[modulo] ?? [];
    if (subs.some((s) => userService.puedeVerSubmodulo(s.key))) return true;
    return router.createUrlTree(['/403']);
  };
};
