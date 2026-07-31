import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { UserService } from '../services/user.service';

/**
 * AC2 — bloquea a la persona "chofer" (rol `chofer_transportista`, experiencia
 * reducida por cédula + PIN) el acceso al módulo de plataforma "Tecnología".
 * Es público para el resto de usuarios; las secciones sensibles (versiones de
 * app, reportes de errores, monitoreo) llevan además `tecnologiaGuard`.
 * Un usuario elevado/tecnología que además fuera chofer SÍ pasa.
 */
export const noChoferGuard: CanActivateFn = () => {
  const userService = inject(UserService);
  const router = inject(Router);
  const bloqueado = userService.esChofer() && !userService.esTecnologia();
  return bloqueado ? router.createUrlTree(['/403']) : true;
};
