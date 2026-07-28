import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { UserService } from '../services/user.service';

/**
 * Y11 — Módulo "Tecnología" de plataforma (historial de versiones, versiones de
 * la app, reportes de errores, monitoreo de infraestructura). Reservado a los
 * roles `admin` y `tecnologia`. Defensa en profundidad junto a la RLS
 * (`sgc.es_tecnologia()`) y al ocultado en el sidebar.
 */
export const tecnologiaGuard: CanActivateFn = () => {
  const userService = inject(UserService);
  const router = inject(Router);
  return userService.esTecnologia() ? true : router.createUrlTree(['/403']);
};
