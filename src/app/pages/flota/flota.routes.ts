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
    loadComponent: () =>
      import('../../../shared/components/coming-soon/coming-soon').then((m) => m.ComingSoon),
    data: { section: 'Mantenimientos' },
    title: 'Mantenimientos — Flota',
  },
  {
    path: 'conductores',
    loadComponent: () =>
      import('../../../shared/components/coming-soon/coming-soon').then((m) => m.ComingSoon),
    data: { section: 'Conductores' },
    title: 'Conductores — Flota',
  },
  {
    path: 'combustible',
    loadComponent: () =>
      import('../../../shared/components/coming-soon/coming-soon').then((m) => m.ComingSoon),
    data: { section: 'Combustible' },
    title: 'Combustible — Flota',
  },
  {
    path: 'reportes',
    loadComponent: () =>
      import('../../../shared/components/coming-soon/coming-soon').then((m) => m.ComingSoon),
    data: { section: 'Reportes de Flota' },
    title: 'Reportes — Flota',
  },
];
