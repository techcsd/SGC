import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { UserService } from '../services/user.service';

/**
 * R14 — Submódulos de flota reservados a roles elevados (admin/dirección/
 * gerencia/jefe_flota). El chofer NO accede a Reportes, Panel del día,
 * Responsabilidad (de otros) ni la lista de Conductores. Defensa en profundidad
 * junto a la RLS y al ocultado del sidebar.
 */
export const flotaElevadoGuard: CanActivateFn = () => {
  const userService = inject(UserService);
  const router = inject(Router);
  return userService.esFlotaElevado() ? true : router.createUrlTree(['/403']);
};
