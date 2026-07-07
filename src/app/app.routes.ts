import { Routes } from '@angular/router';
import { authGuard } from './core/guards/auth.guard';
import { moduleGuard } from './core/guards/module.guard';

export const routes: Routes = [
  {
    path: 'auth',
    loadComponent: () => import('./pages/auth/auth').then((m) => m.Auth),
  },
  {
    path: 'auth/set-password',
    loadComponent: () => import('./pages/auth/set-password/set-password').then((m) => m.SetPassword),
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
        path: 'soporte',
        loadComponent: () => import('./pages/soporte/soporte').then((m) => m.Soporte),
      },
      {
        path: 'dudas',
        loadComponent: () => import('./pages/dudas/dudas').then((m) => m.Dudas),
      },
      {
        path: 'perfil',
        loadComponent: () => import('./pages/perfil/perfil').then((m) => m.Perfil),
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
      {
        path: 'flota',
        canActivate: [moduleGuard('flota')],
        loadChildren: () => import('./pages/flota/flota.routes').then((m) => m.flotaRoutes),
      },
      {
        path: 'bitacora',
        canActivate: [moduleGuard('bitacora')],
        loadChildren: () => import('./pages/bitacora/bitacora.routes').then((m) => m.bitacoraRoutes),
      },
      {
        path: 'documentos',
        canActivate: [moduleGuard('documentos')],
        loadChildren: () => import('./pages/documentos/documentos.routes').then((m) => m.documentosRoutes),
      },
      {
        path: 'compras',
        canActivate: [moduleGuard('compras')],
        loadChildren: () =>
          import('./pages/compras/compras.routes').then((m) => m.comprasRoutes),
      },
      {
        path: 'rrhh',
        canActivate: [moduleGuard('rrhh')],
        loadChildren: () => import('./pages/rrhh/rrhh.routes').then((m) => m.rrhhRoutes),
      },
      {
        path: 'proyectos',
        canActivate: [moduleGuard('proyectos')],
        loadChildren: () =>
          import('./pages/proyectos/proyectos.routes').then((m) => m.proyectosRoutes),
      },
      {
        path: 'legal',
        canActivate: [moduleGuard('legal')],
        loadChildren: () => import('./pages/legal/legal.routes').then((m) => m.legalRoutes),
      },
      {
        // No module guard here: any authenticated user has "Mis tareas".
        // The manager-only "gestion" child guards itself with moduleGuard('tareas').
        path: 'tareas',
        loadChildren: () => import('./pages/tareas/tareas.routes').then((m) => m.tareasRoutes),
      },
      {
        // Internal messaging — available to every authenticated user.
        path: 'mensajes',
        loadComponent: () => import('./pages/mensajes/mensajes').then((m) => m.Mensajes),
      },
    ],
  },
  {
    path: '403',
    loadComponent: () => import('./pages/forbidden/forbidden').then((m) => m.Forbidden),
  },
  { path: '**', redirectTo: '' },
];
