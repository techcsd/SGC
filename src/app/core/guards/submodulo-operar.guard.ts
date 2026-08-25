import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { UserService } from '../services/user.service';

/**
 * AY4 — Guard por submódulo a nivel OPERAR (no basta con 'ver'). Igual que
 * submoduloGuard pero exige nivel 'operar' — para secciones sensibles que un
 * rol con solo lectura del submódulo NO debe abrir (p. ej. costos/finanzas de
 * una obra: un ingeniero con `proyectos.obras=ver` ve la ficha y el cronograma,
 * pero no los costos). Los roles con el MÓDULO padre completo tienen 'operar'
 * por compat, así que conservan el acceso.
 */
export const submoduloOperarGuard = (submodulo: string): CanActivateFn => {
  return () => {
    const userService = inject(UserService);
    const router = inject(Router);
    return userService.puedeOperarSubmodulo(submodulo) ? true : router.createUrlTree(['/403']);
  };
};
