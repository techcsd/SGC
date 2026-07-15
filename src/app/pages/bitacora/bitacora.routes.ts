import { Routes } from '@angular/router';

export const bitacoraRoutes: Routes = [
  { path: '', redirectTo: 'nueva', pathMatch: 'full' },
  { path: 'nueva', loadComponent: () => import('./nueva/nueva').then((m) => m.Nueva) },
  { path: 'historial', loadComponent: () => import('./historial/historial').then((m) => m.Historial) },
  { path: 'dashboard', loadComponent: () => import('./dashboard/dashboard').then((m) => m.BitacoraDashboard), title: 'Dashboard de bitácoras' },
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
  {
    // Engineers reach a conduce for their own delivery here (RLS scopes the
    // salida to their project). The /inventario/... conduce route is behind the
    // inventario module guard, which field engineers don't have.
    path: 'entregas/:id/conduce',
    loadComponent: () => import('../inventario/conduce/conduce').then((m) => m.Conduce),
    title: 'Conduce',
  },
];
