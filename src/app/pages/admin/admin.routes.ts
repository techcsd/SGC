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
  {
    path: 'reportes',
    loadComponent: () => import('./reportes/reportes').then((m) => m.AdminReportes),
    title: 'Comentarios y Reportes — Administración',
  },
  {
    path: 'unidades',
    loadComponent: () => import('./unidades/unidades').then((m) => m.AdminUnidades),
    title: 'Unidades — Administración',
  },
  {
    path: 'bitacora-catalogos',
    loadComponent: () =>
      import('./bitacora-catalogos/bitacora-catalogos').then((m) => m.AdminBitacoraCatalogos),
    title: 'Catálogos de bitácora — Administración',
  },
  {
    path: 'auditoria',
    loadComponent: () => import('./auditoria/auditoria').then((m) => m.AdminAuditoria),
    title: 'Auditoría — Administración',
  },
];
