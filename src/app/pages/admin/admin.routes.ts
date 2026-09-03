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
    // AY7 — usuarios de prueba con roles, sin correo real (solo admin).
    path: 'usuarios-test',
    loadComponent: () => import('./usuarios-test/usuarios-test').then((m) => m.AdminUsuariosTest),
    title: 'Usuarios de prueba — Administración',
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
  // Y11 — movidas al módulo Tecnología. Redirect para no romper enlaces viejos.
  { path: 'app-versiones', redirectTo: '/tecnologia/app-versiones', pathMatch: 'full' },
  {
    path: 'historial-versiones',
    redirectTo: '/tecnologia/historial-versiones',
    pathMatch: 'full',
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
  {
    path: 'notificaciones',
    loadComponent: () => import('./notificaciones/notificaciones').then((m) => m.AdminNotificaciones),
    title: 'Notificaciones — Administración',
  },
  {
    // AT23 — matriz de notificaciones: quién recibe cada evento (por rol), editable.
    path: 'matriz-notificaciones',
    loadComponent: () => import('./matriz-notificaciones/matriz-notificaciones').then((m) => m.AdminMatrizNotificaciones),
    title: 'Matriz de notificaciones — Administración',
  },
  {
    path: 'empresa',
    loadComponent: () => import('./empresa/empresa').then((m) => m.AdminEmpresa),
    title: 'Empresa — Administración',
  },
  {
    path: 'orden-modulos',
    loadComponent: () => import('./orden-modulos/orden-modulos').then((m) => m.AdminOrdenModulos),
    title: 'Orden de módulos — Administración',
  },
  {
    // AY5 — reporte de almacenes duplicados + fusión (admin; server-side gate).
    path: 'almacenes-duplicados',
    loadComponent: () => import('./almacenes-duplicados/almacenes-duplicados').then((m) => m.AdminAlmacenesDuplicados),
    title: 'Almacenes duplicados — Administración',
  },
  {
    // BI6/AU18 — detección + fusión de personas duplicadas (admin/tecnología; gate server-side).
    path: 'usuarios-duplicados',
    loadComponent: () => import('./usuarios-duplicados/usuarios-duplicados').then((m) => m.AdminUsuariosDuplicados),
    title: 'Usuarios duplicados — Administración',
  },
];
