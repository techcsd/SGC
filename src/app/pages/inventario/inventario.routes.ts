import { Routes } from '@angular/router';
import { submoduloGuard } from '../../core/guards/submodulo.guard';

// AN2 — cada ruta hija se gatea por su submódulo granular (Ver = entrar).
// El parent (`app.routes`) ya deja pasar por módulo completo O por cualquier
// submódulo; aquí se afina para que un rol granular vea SOLO lo suyo. Tener el
// módulo `inventario` implica 'operar' en todos (compat), así que ningún rol
// completo pierde acceso.
export const inventarioRoutes: Routes = [
  {
    path: '',
    redirectTo: 'articulos',
    pathMatch: 'full',
  },
  {
    path: 'articulos',
    canActivate: [submoduloGuard('inventario.articulos')],
    loadComponent: () => import('./articulos/articulos').then((m) => m.Articulos),
    title: 'Artículos — Inventario',
  },
  {
    path: 'activos',
    canActivate: [submoduloGuard('inventario.articulos')],
    loadComponent: () => import('./activos/activos').then((m) => m.Activos),
    title: 'Activos Fijos — Inventario',
  },
  {
    path: 'entradas',
    canActivate: [submoduloGuard('inventario.entradas')],
    loadComponent: () => import('./entradas/entradas').then((m) => m.Entradas),
    title: 'Entradas — Inventario',
  },
  {
    path: 'salidas',
    canActivate: [submoduloGuard('inventario.salidas')],
    loadComponent: () => import('./salidas/salidas').then((m) => m.Salidas),
    title: 'Salidas — Inventario',
  },
  {
    path: 'conduces',
    canActivate: [submoduloGuard('inventario.salidas')],
    loadComponent: () => import('./conduces/conduces').then((m) => m.Conduces),
    title: 'Conduces — Inventario',
  },
  {
    path: 'confirmaciones',
    canActivate: [submoduloGuard('inventario.salidas')],
    loadComponent: () => import('./confirmaciones/confirmaciones').then((m) => m.Confirmaciones),
    title: 'Confirmaciones de entrega — Inventario',
  },
  {
    path: 'movimientos',
    canActivate: [submoduloGuard('inventario.articulos')],
    loadComponent: () => import('./movimientos/movimientos').then((m) => m.Movimientos),
    title: 'Movimientos — Inventario',
  },
  {
    path: 'salidas/:id/conduce',
    canActivate: [submoduloGuard('inventario.salidas')],
    loadComponent: () => import('./conduce/conduce').then((m) => m.Conduce),
    title: 'Conduce',
  },
  {
    path: 'bodegas',
    canActivate: [submoduloGuard('inventario.articulos')],
    loadComponent: () => import('./bodegas/bodegas').then((m) => m.Bodegas),
    title: 'Almacenes — Inventario',
  },
  {
    // AP2 — inventario de un almacén específico (accesible desde el listado de
    // almacenes y desde la vista del proyecto). Gate propio: quien pueda ver
    // inventario del almacén (RPC valida por rol/responsable). Ruta libre de
    // submódulo para no cerrarla a responsables de obra sin módulo Inventario.
    path: 'almacen/:id',
    loadComponent: () => import('./almacen-inventario/almacen-inventario').then((m) => m.AlmacenInventario),
    title: 'Inventario del almacén',
  },
  {
    // AP2/AP5 — inventario del almacén de una obra (desde la vista del proyecto).
    path: 'almacen/obra/:proyectoId',
    loadComponent: () => import('./almacen-inventario/almacen-inventario').then((m) => m.AlmacenInventario),
    title: 'Inventario del almacén',
  },
  {
    path: 'categorias',
    canActivate: [submoduloGuard('inventario.articulos')],
    loadComponent: () => import('./categorias/categorias').then((m) => m.InventarioCategorias),
    title: 'Categorías — Inventario',
  },
  {
    path: 'conteos',
    canActivate: [submoduloGuard('inventario.conteos')],
    loadComponent: () => import('./conteos/conteos').then((m) => m.Conteos),
    title: 'Conteos y ajustes — Inventario',
  },
  {
    path: 'reposicion',
    canActivate: [submoduloGuard('inventario.articulos')],
    loadComponent: () => import('./reposicion/reposicion').then((m) => m.Reposicion),
    title: 'Reposición — Inventario',
  },
  {
    path: 'reportes',
    canActivate: [submoduloGuard('inventario.salidas')],
    loadComponent: () => import('./reportes/reportes').then((m) => m.Reportes),
    title: 'Reportes — Inventario',
  },
];
