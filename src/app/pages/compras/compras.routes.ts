import { Routes } from '@angular/router';

export const comprasRoutes: Routes = [
  { path: '', redirectTo: 'proveedores', pathMatch: 'full' },
  {
    path: 'proveedores',
    loadComponent: () => import('./proveedores/proveedores').then((m) => m.Proveedores),
    title: 'Proveedores — Compras',
  },
  {
    path: 'ordenes',
    loadComponent: () => import('./ordenes/ordenes').then((m) => m.Ordenes),
    title: 'Órdenes de Compra — Compras',
  },
  {
    path: 'reportes',
    loadComponent: () => import('./reportes/reportes').then((m) => m.ComprasReportes),
    title: 'Reportes — Compras',
  },
];
