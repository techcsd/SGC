import { Routes } from '@angular/router';

export const rrhhRoutes: Routes = [
  { path: '', redirectTo: 'empleados', pathMatch: 'full' },
  {
    path: 'empleados',
    loadComponent: () => import('./empleados/empleados').then((m) => m.Empleados),
    title: 'Empleados — RRHH',
  },
  {
    path: 'asistencia',
    loadComponent: () => import('./asistencia/asistencia').then((m) => m.Asistencia),
    title: 'Asistencia — RRHH',
  },
  {
    path: 'ausencias',
    loadComponent: () => import('./ausencias/ausencias').then((m) => m.Ausencias),
    title: 'Ausencias y vacaciones — RRHH',
  },
  {
    path: 'reportes',
    loadComponent: () => import('./reportes/reportes').then((m) => m.RrhhReportes),
    title: 'Reportes — RRHH',
  },
];
