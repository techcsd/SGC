import { Routes } from '@angular/router';
import { flotaElevadoGuard } from '../../core/guards/flota-elevado.guard';
import { submoduloGuard } from '../../core/guards/submodulo.guard';

// AN2 — el parent (`app.routes`) deja pasar por módulo `flota` completo O por
// cualquier submódulo granular; cada hija afina con `submoduloGuard`. Las rutas
// sensibles (conductores, seguimiento, echadas, conciliación, panel, reportes,
// accidentes, responsabilidad) conservan `flotaElevadoGuard` — no se relajan.

export const flotaRoutes: Routes = [
  {
    path: '',
    redirectTo: 'vehiculos',
    pathMatch: 'full',
  },
  {
    path: 'vehiculos',
    canActivate: [submoduloGuard('flota.vehiculos')],
    loadComponent: () => import('./vehiculos/vehiculos').then((m) => m.FlotaVehiculos),
    title: 'Vehículos — Flota',
  },
  {
    path: 'vehiculos/:id',
    canActivate: [submoduloGuard('flota.vehiculos')],
    loadComponent: () =>
      import('./vehiculos/detalle/vehiculo-detalle').then((m) => m.VehiculoDetalle),
    title: 'Perfil de vehículo — Flota',
  },
  {
    path: 'reporte-semanal',
    canActivate: [submoduloGuard('flota.vehiculos')],
    loadComponent: () =>
      import('./reporte-semanal/reporte-semanal').then((m) => m.ReporteSemanal),
    title: 'Inspección vehículo — Flota',
  },
  {
    path: 'mantenimientos',
    canActivate: [submoduloGuard('flota.mantenimientos')],
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
    canActivate: [submoduloGuard('flota.combustible')],
    loadComponent: () => import('./combustible/combustible').then((m) => m.Combustible),
    title: 'Combustible — Flota',
  },
  {
    path: 'combustible-log',
    canActivate: [flotaElevadoGuard],
    loadComponent: () => import('./combustible-log/combustible-log').then((m) => m.CombustibleLog),
    title: 'Registro de echadas — Flota',
  },
  {
    path: 'combustible-dashboard',
    canActivate: [submoduloGuard('flota.combustible')],
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
    canActivate: [submoduloGuard('flota.rutas')],
    loadComponent: () => import('./rutas/rutas').then((m) => m.Rutas),
    title: 'Rutas — Flota',
  },
  {
    path: 'seguimiento',
    canActivate: [flotaElevadoGuard],
    loadComponent: () => import('./seguimiento/seguimiento').then((m) => m.Seguimiento),
    title: 'Seguimiento — Flota',
  },
  {
    path: 'checklists',
    canActivate: [submoduloGuard('flota.vehiculos')],
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
    canActivate: [submoduloGuard('flota.vehiculos')],
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
