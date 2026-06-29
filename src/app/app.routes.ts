import { Routes } from '@angular/router';
import { authGuard } from './core/guards/auth.guard';
import { moduleGuard } from './core/guards/module.guard';

export const routes: Routes = [
  {
    path: 'auth',
    loadComponent: () => import('./pages/auth/auth').then((m) => m.Auth),
  },
  {
    path: '',
    loadComponent: () => import('../shared/components/shell/shell').then((m) => m.Shell),
    canActivate: [authGuard],
    children: [
      { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
      {
        path: 'dashboard',
        loadComponent: () => import('./pages/dashboard/dashboard').then((m) => m.Dashboard),
      },
      {
        path: 'inventario',
        canActivate: [moduleGuard('inventario')],
        loadChildren: () =>
          import('./pages/inventario/inventario.routes').then((m) => m.inventarioRoutes),
      },
      {
        path: 'admin',
        canActivate: [moduleGuard('admin')],
        loadChildren: () => import('./pages/admin/admin.routes').then((m) => m.adminRoutes),
      },
    ],
  },
  {
    path: '403',
    loadComponent: () => import('./pages/forbidden/forbidden').then((m) => m.Forbidden),
  },
  { path: '**', redirectTo: '' },
];
