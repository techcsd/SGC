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
 *
 * `extraAllow` (opcional) abre el branch a roles que no tienen el módulo ni un
 * submódulo pero que SÍ deben alcanzar alguna ruta hija concreta (p. ej. AS7:
 * los roles de proyecto entran a `/inventario/requisiciones`). Las demás hijas
 * siguen protegidas por su `submoduloGuard`, así que este extra no las expone.
 */
export const moduloOSubmoduloGuard = (
  modulo: string,
  extraAllow?: (u: UserService) => boolean,
): CanActivateFn => {
  return () => {
    const userService = inject(UserService);
    const router = inject(Router);
    if (userService.hasModulo(modulo)) return true;
    if (extraAllow?.(userService)) return true;
    const subs = SUBMODULOS[modulo] ?? [];
    if (subs.some((s) => userService.puedeVerSubmodulo(s.key))) return true;
    return router.createUrlTree(['/403']);
  };
};
