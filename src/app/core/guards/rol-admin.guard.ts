import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { UserService } from '../services/user.service';

/**
 * CZ3/DZ-08 — Guard de ROL estricto (no de módulo). El Vault vive bajo
 * `/admin/vault`, pero NO puede heredar `moduleGuard('admin')` del padre: ese
 * guard es por MÓDULO, y si algún día otro rol recibiera el módulo `admin`
 * (hoy solo lo tiene el rol `admin`, ver docs/SUBMODULOS-SENSIBLES.md §1),
 * vería el Vault de un golpe. Este guard mira el ROL directamente — mismo
 * predicado que `sgc.puede_ver_vault()` (= `is_admin()`) en el servidor.
 */
export const rolAdminGuard: CanActivateFn = () => {
  const userService = inject(UserService);
  const router = inject(Router);
  return userService.hasRole('admin') ? true : router.createUrlTree(['/403']);
};
