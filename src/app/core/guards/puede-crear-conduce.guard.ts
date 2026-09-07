import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { UserService } from '../services/user.service';
import { SalidasService } from '../../../shared/services/salidas.service';

/**
 * BJ3 — Guard de la pantalla de Salidas/Conduce. La visibilidad se deriva de la
 * MISMA regla del servidor que autoriza la creación (regla BH1: "ninguna acción se
 * pinta si el guard la va a negar"). Deja pasar a quien:
 *   · pueda VER el submódulo `inventario.salidas` (almacén/logística/admin), O
 *   · satisfaga `sgc.puede_crear_conduce()` (admin / módulo inventario / CHOFER
 *     activo) — el chofer no tiene el submódulo pero SÍ debe poder crear su conduce.
 *
 * Antes la ruta solo tenía `submoduloGuard('inventario.salidas')` → un chofer
 * elegible ni siquiera podía abrir la pantalla (ese desajuste era el bug BJ3).
 */
export const puedeCrearConduceGuard: CanActivateFn = async () => {
  const userService = inject(UserService);
  const salidasService = inject(SalidasService);
  const router = inject(Router);

  if (userService.puedeVerSubmodulo('inventario.salidas')) return true;
  if (await salidasService.puedeCrearConduce()) return true;
  return router.createUrlTree(['/403']);
};
