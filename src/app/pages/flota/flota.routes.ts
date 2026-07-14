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
    loadComponent: () => import('./conductores/conductores').then((m) => m.Conductores),
    title: 'Conductores — Flota',
  },
  {
    path: 'conductores/:id',
    loadComponent: () =>
      import('./conductores/detalle/conductor-detalle').then((m) => m.ConductorDetalle),
    title: 'Perfil de conductor — Flota',
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
