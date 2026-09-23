import { Routes } from '@angular/router';

export const bitacoraRoutes: Routes = [
  { path: '', redirectTo: 'nueva', pathMatch: 'full' },
  { path: 'nueva', loadComponent: () => import('./nueva/nueva').then((m) => m.Nueva) },
  // BN1 — orden de trabajo (flujo propio con dos firmas: ingeniero + cliente).
  { path: 'orden-trabajo', loadComponent: () => import('./orden-trabajo/orden-trabajo').then((m) => m.OrdenTrabajo), title: 'Orden de trabajo' },
  // BW1 — lista de órdenes de trabajo (ver/revisar/compartir). Antes del :id (aunque el prefijo difiere).
  { path: 'ordenes-trabajo', loadComponent: () => import('./orden-trabajo/orden-trabajo-lista').then((m) => m.OrdenTrabajoLista), title: 'Órdenes de trabajo' },
  { path: 'orden-trabajo/:id', loadComponent: () => import('./orden-trabajo/orden-trabajo-ficha').then((m) => m.OrdenTrabajoFicha), title: 'Orden de trabajo' },
  { path: 'historial', loadComponent: () => import('./historial/historial').then((m) => m.Historial) },
  { path: 'dashboard', loadComponent: () => import('./dashboard/dashboard').then((m) => m.BitacoraDashboard), title: 'Dashboard de bitácoras' },
  { path: 'cobertura', loadComponent: () => import('./cobertura/cobertura').then((m) => m.BitacoraCobertura), title: 'Cobertura de bitácoras' },
  // BO9 — revisión de oficina de las medidas de moldes por obra.
  { path: 'moldes', loadComponent: () => import('./moldes/moldes').then((m) => m.BitacoraMoldes), title: 'Medidas de moldes' },
  // BO10 — cartillas de acero (bandeja de oficina + captura + reporte de acero).
  { path: 'cartillas', loadComponent: () => import('./cartillas/cartillas').then((m) => m.Cartillas), title: 'Cartillas de acero' },
  { path: 'cartillas/:id', loadComponent: () => import('./cartillas/cartillas').then((m) => m.Cartillas), title: 'Cartillas de acero' },
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
