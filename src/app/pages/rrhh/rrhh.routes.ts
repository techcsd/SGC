import { Routes } from '@angular/router';
import { submoduloGuard } from '../../core/guards/submodulo.guard';

// DH11 — cada submódulo se gatea con submoduloGuard (como obra/flota): un rol
// con solo rrhh.ausencias, por ejemplo, entra a Ausencias sin ver Empleados.
export const rrhhRoutes: Routes = [
  { path: '', redirectTo: 'empleados', pathMatch: 'full' },
  {
    path: 'empleados',
    canActivate: [submoduloGuard('rrhh.empleados')],
    loadComponent: () => import('./empleados/empleados').then((m) => m.Empleados),
    title: 'Empleados — RRHH',
  },
  {
    path: 'asistencia',
    canActivate: [submoduloGuard('rrhh.asistencia')],
    loadComponent: () => import('./asistencia/asistencia').then((m) => m.Asistencia),
    title: 'Asistencia — RRHH',
  },
  {
    path: 'ausencias',
    canActivate: [submoduloGuard('rrhh.ausencias')],
    loadComponent: () => import('./ausencias/ausencias').then((m) => m.Ausencias),
    title: 'Ausencias y vacaciones — RRHH',
  },
  {
    path: 'reportes',
    loadComponent: () => import('./reportes/reportes').then((m) => m.RrhhReportes),
    title: 'Reportes — RRHH',
  },
];
