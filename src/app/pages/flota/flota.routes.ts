import { Routes } from '@angular/router';

export const flotaRoutes: Routes = [
  {
    path: '',
    redirectTo: 'vehiculos',
    pathMatch: 'full',
  },
  {
    path: 'vehiculos',
    loadComponent: () => import('./vehiculos/vehiculos').then((m) => m.FlotaVehiculos),
    title: 'Vehículos — Flota',
  },
  {
    path: 'mantenimientos',
    loadComponent: () => import('./mantenimientos/mantenimientos').then((m) => m.Mantenimientos),
    title: 'Mantenimientos — Flota',
  },
  {
    path: 'conductores',
    loadComponent: () => import('./conductores/conductores').then((m) => m.Conductores),
    title: 'Conductores — Flota',
  },
  {
    path: 'combustible',
    loadComponent: () => import('./combustible/combustible').then((m) => m.Combustible),
    title: 'Combustible — Flota',
  },
  {
    path: 'rutas',
    loadComponent: () => import('./rutas/rutas').then((m) => m.Rutas),
    title: 'Rutas — Flota',
  },
  {
    path: 'checklists',
    loadComponent: () => import('./checklists/checklists').then((m) => m.Checklists),
    title: 'Checklists — Flota',
  },
  {
    path: 'responsabilidad',
    loadComponent: () =>
      import('./responsabilidad/responsabilidad').then((m) => m.Responsabilidad),
    title: 'Responsabilidad — Flota',
  },
  {
    path: 'reportes',
    loadComponent: () => import('./reportes/reportes').then((m) => m.FlotaReportes),
    title: 'Reportes — Flota',
  },
];
