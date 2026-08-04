import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { UserService } from '../services/user.service';

/**
 * AF32 — Proveedores es accesible por quien tiene el módulo Compras Y ADEMÁS por
 * el jefe de flota (flota elevado), que necesita registrar ferreterías para los
 * choferes sin darle acceso al resto de Compras (órdenes, reportes).
 */
export const proveedoresGuard: CanActivateFn = () => {
  const userService = inject(UserService);
  const router = inject(Router);
  return userService.hasModulo('compras') || userService.esFlotaElevado()
    ? true
    : router.createUrlTree(['/403']);
};
