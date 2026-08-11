import { Routes } from '@angular/router';
import { moduleGuard } from '../../core/guards/module.guard';
import { proveedoresGuard } from '../../core/guards/proveedores.guard';
import { submoduloGuard } from '../../core/guards/submodulo.guard';

export const comprasRoutes: Routes = [
  { path: '', redirectTo: 'proveedores', pathMatch: 'full' },
  {
    // AF32 — abierto a compras Y al jefe de flota (para registrar ferreterías).
    path: 'proveedores',
    canActivate: [proveedoresGuard],
    loadComponent: () => import('./proveedores/proveedores').then((m) => m.Proveedores),
    title: 'Proveedores — Compras',
  },
  {
    path: 'ordenes',
    canActivate: [submoduloGuard('compras.ordenes')], // AN2 — módulo o submódulo granular
    loadComponent: () => import('./ordenes/ordenes').then((m) => m.Ordenes),
    title: 'Órdenes de Compra — Compras',
  },
  {
    path: 'reportes',
    canActivate: [moduleGuard('compras')],
    loadComponent: () => import('./reportes/reportes').then((m) => m.ComprasReportes),
    title: 'Reportes — Compras',
  },
];
