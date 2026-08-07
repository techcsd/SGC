import { Routes } from '@angular/router';

export const proyectosRoutes: Routes = [
  {
    path: '',
    loadComponent: () => import('./lista/lista').then((m) => m.Lista),
    title: 'Proyectos',
  },
  {
    // Z13 — crear proyecto como ruta dedicada (deep-linkable, botón Atrás).
    path: 'nuevo',
    loadComponent: () => import('./lista/lista').then((m) => m.Lista),
    data: { modo: 'crear' },
    title: 'Nuevo proyecto',
  },
  {
    path: 'kpi',
    loadComponent: () => import('./kpi/kpi').then((m) => m.Kpi),
    title: 'Ranking de Encargados — Proyectos',
  },
  {
    path: 'historial',
    loadComponent: () => import('./historial/historial').then((m) => m.ProyectosHistorial),
    title: 'Historial de proyectos',
  },
  {
    path: 'clima',
    loadComponent: () => import('./clima/clima').then((m) => m.ProyectosClima),
    title: 'Reportes de clima — Proyectos',
  },
  {
    // Y15 — Cronograma de un proyecto (deep-linkable desde avisos/emails).
    path: ':id/cronograma',
    loadComponent: () => import('./cronograma/cronograma').then((m) => m.Cronograma),
    title: 'Cronograma — Proyectos',
  },
  {
    // AA23 QW4 — reporte de costo de material real por obra.
    path: ':id/costos',
    loadComponent: () => import('./costos/costos').then((m) => m.ProyectoCostos),
    title: 'Costo de material — Proyectos',
  },
  {
    // AH15 — compras (órdenes de compra + ferretería) ligadas a la obra.
    path: ':id/compras',
    loadComponent: () => import('./compras/compras').then((m) => m.ProyectoCompras),
    title: 'Compras — Proyectos',
  },
  {
    // Z13 — detalle del proyecto como ruta dedicada (deep-linkable, botón Atrás).
    path: ':id',
    loadComponent: () => import('./lista/lista').then((m) => m.Lista),
    title: 'Proyecto',
  },
];
