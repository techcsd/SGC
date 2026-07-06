import { Routes } from '@angular/router';

export const legalRoutes: Routes = [
  { path: '', redirectTo: 'expedientes', pathMatch: 'full' },
  { path: 'expedientes', loadComponent: () => import('./expedientes/expedientes').then((m) => m.Expedientes) },
  { path: 'contratos', loadComponent: () => import('./contratos/contratos').then((m) => m.Contratos) },
  { path: 'aprobaciones', loadComponent: () => import('./aprobaciones/aprobaciones').then((m) => m.Aprobaciones) },
];
