import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { UserService } from '../services/user.service';

export const moduleGuard = (modulo: string): CanActivateFn => {
  return () => {
    const userService = inject(UserService);
    const router = inject(Router);

    if (userService.hasModulo(modulo) || userService.hasRole('admin')) {
      return true;
    }

    return router.createUrlTree(['/403']);
  };
};
