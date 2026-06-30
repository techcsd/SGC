import { Routes } from '@angular/router';

export const adminRoutes: Routes = [
  {
    path: '',
    redirectTo: 'usuarios',
    pathMatch: 'full',
  },
  {
    path: 'usuarios',
    loadComponent: () => import('./usuarios/usuarios').then((m) => m.AdminUsuarios),
    title: 'Usuarios — Administración',
  },
  {
    path: 'roles',
    loadComponent: () => import('./roles/roles').then((m) => m.AdminRoles),
    title: 'Roles — Administración',
  },
];
