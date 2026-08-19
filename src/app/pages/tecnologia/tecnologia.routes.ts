import { Routes } from '@angular/router';
import { moduleGuard } from '../../core/guards/module.guard';
import { tecnologiaGuard } from '../../core/guards/tecnologia.guard';

export const tecnologiaRoutes: Routes = [
  { path: '', redirectTo: 'guia', pathMatch: 'full' },
  // Guía de homologación: informativa para TODO usuario autenticado (sin gate de módulo).
  {
    path: 'guia',
    loadComponent: () => import('./guia/guia').then((m) => m.TecGuia),
    title: 'Homologación — Tecnología',
  },
  // Gestión: gateada por el módulo 'tecnologia'.
  {
    path: 'homologacion',
    canActivate: [moduleGuard('tecnologia')],
    loadComponent: () => import('./homologacion/homologacion').then((m) => m.TecHomologacion),
    title: 'Herramientas — Tecnología',
  },
  {
    path: 'matriz',
    canActivate: [moduleGuard('tecnologia')],
    loadComponent: () => import('./matriz/matriz').then((m) => m.TecMatriz),
    title: 'Matriz puesto × herramienta — Tecnología',
  },
  {
    path: 'inventario',
    canActivate: [moduleGuard('tecnologia')],
    loadComponent: () => import('./inventario/inventario').then((m) => m.TecInventario),
    title: 'Inventario tecnológico — Tecnología',
  },
  {
    path: 'compras',
    canActivate: [moduleGuard('tecnologia')],
    loadComponent: () => import('./compras/compras').then((m) => m.TecCompras),
    title: 'Compras tecnológicas — Tecnología',
  },

  // ── Y11 — Plataforma / sistema: reservado a admin | rol tecnologia ──────────
  // Reportes de errores (Y6), historial de versiones y versiones de la app.
  // Los dos últimos vivían bajo /admin/*; se agrupan aquí sin mover el código
  // (los componentes siguen en pages/admin/*), y /admin/* redirige aquí.
  {
    path: 'reportes-errores',
    canActivate: [tecnologiaGuard],
    loadComponent: () =>
      import('./reportes-errores/reportes-errores').then((m) => m.TecReportesErrores),
    title: 'Reportes de errores — Tecnología',
  },
  {
    // AY15 — Jira interno (board Kanban de issues). Gate: es_tecnologia (server + guard).
    path: 'issues',
    canActivate: [tecnologiaGuard],
    loadComponent: () => import('../admin/jira/jira').then((m) => m.AdminJira),
    title: 'Issues (Jira interno) — Tecnología',
  },
  {
    // AC3 — QA (gestión de pruebas): casos, corridas y checklist por versión.
    path: 'qa',
    canActivate: [tecnologiaGuard],
    loadComponent: () => import('./qa/qa').then((m) => m.TecQa),
    title: 'QA (pruebas) — Tecnología',
  },
  {
    // Z26 — Historial de versiones es público (sin guard).
    path: 'historial-versiones',
    loadComponent: () =>
      import('../admin/historial-versiones/historial-versiones').then(
        (m) => m.AdminHistorialVersiones,
      ),
    title: 'Historial de versiones — Tecnología',
  },
  {
    path: 'app-versiones',
    canActivate: [tecnologiaGuard],
    loadComponent: () =>
      import('../admin/app-versiones/app-versiones').then((m) => m.AdminAppVersiones),
    title: 'Versiones de la App — Tecnología',
  },
  {
    // Y17 — Monitoreo de Infraestructura y Suscripciones (SGC-CSI-MOD-01).
    path: 'monitoreo',
    canActivate: [tecnologiaGuard],
    loadComponent: () => import('./monitoreo/monitoreo').then((m) => m.TecMonitoreo),
    title: 'Monitoreo de Infraestructura — Tecnología',
  },
  {
    // AQ7 — Estadísticas de uso (web/app, dispositivos, versiones).
    path: 'estadisticas',
    canActivate: [tecnologiaGuard],
    loadComponent: () => import('./estadisticas/estadisticas').then((m) => m.TecEstadisticas),
    title: 'Estadísticas — Tecnología',
  },
  {
    // AW9 — APIs y consumo: inventario de APIs/servicios + costo estimado/mes.
    path: 'apis-consumo',
    canActivate: [moduleGuard('tecnologia')],
    loadComponent: () => import('./apis-consumo/apis-consumo').then((m) => m.TecApisConsumo),
    title: 'APIs y consumo — Tecnología',
  },
];
