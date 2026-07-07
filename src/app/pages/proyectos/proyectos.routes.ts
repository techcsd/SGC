import { Routes } from '@angular/router';

export const proyectosRoutes: Routes = [
  {
    path: '',
    loadComponent: () => import('./lista/lista').then((m) => m.Lista),
    title: 'Proyectos',
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
];
