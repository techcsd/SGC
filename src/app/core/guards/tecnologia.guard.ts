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

/**
 * AL1 — Guard del contenedor `/tecnologia`. El árbol de rutas mezcla dos mundos:
 * los activos de TI (Tecnología real: gestión por módulo `tecnologia`) y la
 * consola de plataforma "Sistema" (versiones, QA, monitoreo, errores: `es_tecnologia`).
 * El contenedor deja pasar a quien tenga el módulo `tecnologia` O sea es_tecnologia
 * (admin/tecnologia/gerencia/dirección); cada hijo re-valida con su propio guard.
 * Esto corrige la fuga por la que CUALQUIER usuario no-chofer veía "Tecnología".
 */
export const tecnologiaContenedorGuard: CanActivateFn = () => {
  const userService = inject(UserService);
  const router = inject(Router);
  return userService.hasModulo('tecnologia') || userService.esTecnologia()
    ? true
    : router.createUrlTree(['/403']);
};
