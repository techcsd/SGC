import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { UserService } from '../services/user.service';

/**
 * AG12 / AG16 — Guard genérico por submódulo granular. Deja pasar a quien pueda
 * VER el submódulo (que incluye, por compat, a quien tenga el módulo padre o sea
 * admin). Lee el MISMO modelo que el menú (`shell.canAccess*`) y la RLS
 * (`sgc.puede_ver_submodulo`). Reemplaza los guards ad-hoc por submódulo.
 */
export const submoduloGuard = (submodulo: string): CanActivateFn => {
  return () => {
    const userService = inject(UserService);
    const router = inject(Router);
    return userService.puedeVerSubmodulo(submodulo) ? true : router.createUrlTree(['/403']);
  };
};
