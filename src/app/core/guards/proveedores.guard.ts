import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { UserService } from '../services/user.service';

/**
 * AF32 / AG12 — Proveedores es accesible por quien tiene el módulo Compras, por el
 * jefe de flota (flota elevado, que registra ferreterías), Y AHORA por cualquier
 * rol con el permiso granular `compras.proveedores` (ver u operar) — sin darle el
 * resto de Compras. El guard lee el MISMO modelo que el menú y la RLS.
 */
export const proveedoresGuard: CanActivateFn = () => {
  const userService = inject(UserService);
  const router = inject(Router);
  return userService.hasModulo('compras') ||
    userService.esFlotaElevado() ||
    userService.puedeVerSubmodulo('compras.proveedores')
    ? true
    : router.createUrlTree(['/403']);
};
