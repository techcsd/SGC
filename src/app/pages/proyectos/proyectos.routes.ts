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
];
