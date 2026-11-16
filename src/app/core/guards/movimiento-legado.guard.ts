import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { UiFlagsService } from '../../../shared/services/ui-flags.service';

/** DS-35/#59 — si el flag `solicitud_movimiento_oculta` está activo, el módulo de solicitudes de
 *  movimiento (Apoyo de transporte) redirige al conduce, que es la puerta real. Reversible: apagar el flag. */
export const movimientoLegadoGuard: CanActivateFn = async () => {
  const flags = inject(UiFlagsService);
  const router = inject(Router);
  await flags.cargar();
  return flags.movimientoOculto() ? router.createUrlTree(['/inventario/conduces']) : true;
};
