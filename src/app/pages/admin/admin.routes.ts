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
    path: 'parametros',
    loadComponent: () => import('./parametros/parametros').then((m) => m.AdminParametros),
    title: 'Parámetros — Administración',
  },
  {
    path: 'app-versiones',
    loadComponent: () => import('./app-versiones/app-versiones').then((m) => m.AdminAppVersiones),
    title: 'Versiones de la App — Administración',
  },
  {
    path: 'historial-versiones',
    loadComponent: () =>
      import('./historial-versiones/historial-versiones').then((m) => m.AdminHistorialVersiones),
    title: 'Historial de versiones — Administración',
  },
  {
    path: 'otros-valores',
    loadComponent: () => import('./otros-valores/otros-valores').then((m) => m.AdminOtrosValores),
    title: 'Valores "Otro" — Administración',
  },
  {
    path: 'auditoria',
    loadComponent: () => import('./auditoria/auditoria').then((m) => m.AdminAuditoria),
    title: 'Auditoría — Administración',
  },
];
