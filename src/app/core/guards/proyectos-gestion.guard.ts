import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { UserService } from '../services/user.service';

/**
 * AY4c — gestión de proyectos (crear/editar la obra). El Ingeniero de Oficina VE la
 * ficha + costos (submoduloGuard proyectos.obras) pero NO gestiona → este guard lo
 * bloquea de /proyectos/nuevo. Espejo de `sgc.puede_gestionar_proyectos()` (la RLS
 * de escritura de proyectos lo fuerza igual en el servidor).
 */
export const proyectosGestionGuard: CanActivateFn = () => {
  const userService = inject(UserService);
  const router = inject(Router);
  return userService.puedeGestionarProyectos() ? true : router.createUrlTree(['/403']);
};
