import { Routes } from '@angular/router';

export const inventarioRoutes: Routes = [
  {
    path: '',
    redirectTo: 'articulos',
    pathMatch: 'full',
  },
  {
    path: 'articulos',
    loadComponent: () => import('./articulos/articulos').then((m) => m.Articulos),
    title: 'Artículos — Inventario',
  },
  {
    path: 'activos',
    loadComponent: () =>
      import('../../../shared/components/coming-soon/coming-soon').then((m) => m.ComingSoon),
    data: { section: 'Activos Fijos' },
    title: 'Activos Fijos — Inventario',
  },
  {
    path: 'entradas',
    loadComponent: () =>
      import('../../../shared/components/coming-soon/coming-soon').then((m) => m.ComingSoon),
    data: { section: 'Entradas' },
    title: 'Entradas — Inventario',
  },
  {
    path: 'salidas',
    loadComponent: () =>
      import('../../../shared/components/coming-soon/coming-soon').then((m) => m.ComingSoon),
    data: { section: 'Salidas' },
    title: 'Salidas — Inventario',
  },
  {
    path: 'bodegas',
    loadComponent: () =>
      import('../../../shared/components/coming-soon/coming-soon').then((m) => m.ComingSoon),
    data: { section: 'Bodegas' },
    title: 'Bodegas — Inventario',
  },
  {
    path: 'reportes',
    loadComponent: () =>
      import('../../../shared/components/coming-soon/coming-soon').then((m) => m.ComingSoon),
    data: { section: 'Reportes' },
    title: 'Reportes — Inventario',
  },
];
