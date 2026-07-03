import { Routes } from '@angular/router';

export const bitacoraRoutes: Routes = [
  { path: '', redirectTo: 'nueva', pathMatch: 'full' },
  { path: 'nueva', loadComponent: () => import('./nueva/nueva').then((m) => m.Nueva) },
  { path: 'historial', loadComponent: () => import('./historial/historial').then((m) => m.Historial) },
  { path: 'mi-proyecto', loadComponent: () => import('./mi-proyecto/mi-proyecto').then((m) => m.MiProyecto) },
  {
    path: 'solicitudes-material',
    loadComponent: () => import('./solicitudes-material/solicitudes-material').then((m) => m.SolicitudesMaterial),
  },
  {
    path: 'solicitudes-compra',
    loadComponent: () => import('./solicitudes-compra/solicitudes-compra').then((m) => m.SolicitudesCompra),
  },
  {
    path: 'entregas',
    loadComponent: () => import('./entregas/entregas').then((m) => m.Entregas),
  },
];
