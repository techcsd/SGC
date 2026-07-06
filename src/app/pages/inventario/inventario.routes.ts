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
    loadComponent: () => import('./activos/activos').then((m) => m.Activos),
    title: 'Activos Fijos — Inventario',
  },
  {
    path: 'entradas',
    loadComponent: () => import('./entradas/entradas').then((m) => m.Entradas),
    title: 'Entradas — Inventario',
  },
  {
    path: 'salidas',
    loadComponent: () => import('./salidas/salidas').then((m) => m.Salidas),
    title: 'Salidas — Inventario',
  },
  {
    path: 'conduces',
    loadComponent: () => import('./conduces/conduces').then((m) => m.Conduces),
    title: 'Conduces — Inventario',
  },
  {
    path: 'salidas/:id/conduce',
    loadComponent: () => import('./conduce/conduce').then((m) => m.Conduce),
    title: 'Conduce',
  },
  {
    path: 'bodegas',
    loadComponent: () => import('./bodegas/bodegas').then((m) => m.Bodegas),
    title: 'Bodegas — Inventario',
  },
  {
    path: 'reportes',
    loadComponent: () => import('./reportes/reportes').then((m) => m.Reportes),
    title: 'Reportes — Inventario',
  },
];
