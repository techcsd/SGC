import { Routes } from '@angular/router';
import { flotaElevadoGuard } from '../../core/guards/flota-elevado.guard';

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
    path: 'vehiculos/:id',
    loadComponent: () =>
      import('./vehiculos/detalle/vehiculo-detalle').then((m) => m.VehiculoDetalle),
    title: 'Perfil de vehículo — Flota',
  },
  {
    path: 'reporte-semanal',
    loadComponent: () =>
      import('./reporte-semanal/reporte-semanal').then((m) => m.ReporteSemanal),
    title: 'Reporte semanal — Flota',
  },
  {
    path: 'mantenimientos',
    loadComponent: () => import('./mantenimientos/mantenimientos').then((m) => m.Mantenimientos),
    title: 'Mantenimientos — Flota',
  },
  {
    path: 'conductores',
    canActivate: [flotaElevadoGuard],
    loadComponent: () => import('./conductores/conductores').then((m) => m.Conductores),
    title: 'Conductores — Flota',
  },
  {
    path: 'conductores-estado',
    canActivate: [flotaElevadoGuard],
    loadComponent: () =>
      import('./conductores-estado/conductores-estado').then((m) => m.ConductoresEstado),
    title: 'Estado de conductores — Flota',
  },
  {
    path: 'conductores/:id',
    canActivate: [flotaElevadoGuard],
    loadComponent: () =>
      import('./conductores/detalle/conductor-detalle').then((m) => m.ConductorDetalle),
    title: 'Perfil de conductor — Flota',
  },
  {
    path: 'accidentes',
    canActivate: [flotaElevadoGuard],
    loadComponent: () => import('./accidentes/accidentes').then((m) => m.Accidentes),
    title: 'Accidentes — Flota',
  },
  {
    path: 'combustible',
    loadComponent: () => import('./combustible/combustible').then((m) => m.Combustible),
    title: 'Combustible — Flota',
  },
  {
    path: 'combustible-dashboard',
    loadComponent: () =>
      import('./combustible-dashboard/combustible-dashboard').then((m) => m.CombustibleDashboard),
    title: 'Dashboards de combustible — Flota',
  },
  {
    path: 'conciliacion-combustible',
    canActivate: [flotaElevadoGuard],
    loadComponent: () =>
      import('./conciliacion-combustible/conciliacion-combustible').then((m) => m.ConciliacionCombustible),
    title: 'Conciliación de combustible — Flota',
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
    path: 'panel-dia',
    canActivate: [flotaElevadoGuard],
    loadComponent: () => import('./panel-dia/panel-dia').then((m) => m.PanelDia),
    title: 'Panel del día — Flota',
  },
  {
    path: 'avisos',
    loadComponent: () => import('./avisos/avisos').then((m) => m.Avisos),
    title: 'Avisos — Flota',
  },
  {
    path: 'responsabilidad',
    canActivate: [flotaElevadoGuard],
    loadComponent: () =>
      import('./responsabilidad/responsabilidad').then((m) => m.Responsabilidad),
    title: 'Responsabilidad — Flota',
  },
  {
    path: 'reportes',
    canActivate: [flotaElevadoGuard],
    loadComponent: () => import('./reportes/reportes').then((m) => m.FlotaReportes),
    title: 'Reportes — Flota',
  },
];
