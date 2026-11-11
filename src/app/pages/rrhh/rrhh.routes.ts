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
    // DN14 — antes sin guard: cualquier usuario autenticado veía Reportes de RRHH.
    path: 'reportes',
    canActivate: [submoduloGuard('rrhh.reportes')],
    loadComponent: () => import('./reportes/reportes').then((m) => m.RrhhReportes),
    title: 'Reportes — RRHH',
  },
  {
    path: 'contratos',
    canActivate: [submoduloGuard('rrhh.contratos')],
    loadComponent: () => import('./contratos/contratos').then((m) => m.RrhhContratos),
    title: 'Contratos y documentos — RRHH',
  },
  {
    path: 'organigrama',
    canActivate: [submoduloGuard('rrhh.organigrama')],
    loadComponent: () => import('./organigrama/organigrama').then((m) => m.RrhhOrganigrama),
    title: 'Organigrama — RRHH',
  },
  {
    path: 'onboarding',
    canActivate: [submoduloGuard('rrhh.onboarding')],
    loadComponent: () => import('./onboarding/onboarding').then((m) => m.RrhhOnboarding),
    title: 'Reclutamiento — RRHH',
  },
  {
    path: 'nomina',
    canActivate: [submoduloGuard('rrhh.nomina')],
    loadComponent: () => import('./nomina/nomina').then((m) => m.RrhhNomina),
    title: 'Nómina — RRHH',
  },
  {
    path: 'capacitacion',
    canActivate: [submoduloGuard('rrhh.capacitacion')],
    loadComponent: () => import('./capacitacion/capacitacion').then((m) => m.RrhhCapacitacionPage),
    title: 'Capacitación — RRHH',
  },
  {
    path: 'evaluaciones',
    canActivate: [submoduloGuard('rrhh.evaluaciones')],
    loadComponent: () => import('./evaluaciones/evaluaciones').then((m) => m.RrhhEvaluaciones),
    title: 'Evaluaciones — RRHH',
  },
  {
    path: 'tramites',
    canActivate: [submoduloGuard('rrhh.tramites')],
    loadComponent: () => import('./tramites/tramites').then((m) => m.RrhhTramites),
    title: 'Trámites y cumplimiento — RRHH',
  },
  {
    path: 'proveedores',
    canActivate: [submoduloGuard('rrhh.proveedores')],
    loadComponent: () => import('./proveedores/proveedores').then((m) => m.RrhhProveedores),
    title: 'Proveedores — RRHH',
  },
  {
    path: 'activos',
    canActivate: [submoduloGuard('rrhh.activos')],
    loadComponent: () => import('./activos/activos').then((m) => m.RrhhActivos),
    title: 'Activos y oficina — RRHH',
  },
];
