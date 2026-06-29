import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { UserService } from '../services/user.service';

export const authGuard: CanActivateFn = async () => {
  const authService = inject(AuthService);
  const userService = inject(UserService);
  const router = inject(Router);

  const session = await authService.getSession();
  if (!session) {
    return router.createUrlTree(['/auth']);
  }

  if (!userService.profile()) {
    await userService.loadProfile(session.user.id);
  }

  return true;
};
