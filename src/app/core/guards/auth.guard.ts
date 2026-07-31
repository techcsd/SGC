import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { UserService } from '../services/user.service';

export const authGuard: CanActivateFn = async () => {
  const authService = inject(AuthService);
  const userService = inject(UserService);
  const router = inject(Router);

  // ensureValidSession (no getSession) refresca proactivamente un token vencido
  // y devuelve null si el refresh token ya no sirve, evitando entrar a una ruta
  // protegida con una sesión "zombie" (token muerto) que rompería toda escritura.
  const session = await authService.ensureValidSession();
  if (!session) {
    return router.createUrlTree(['/auth']);
  }

  await userService.ensureFreshProfile(session.user.id);

  const profile = userService.profile();
  if (!profile || !profile.activo) {
    await authService.signOut();
    userService.clearProfile();
    return router.createUrlTree(['/auth']);
  }

  return true;
};
