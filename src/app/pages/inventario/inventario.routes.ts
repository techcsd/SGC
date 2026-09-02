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
    // AS7 — bandeja global de requisiciones (todas las obras). SIN gate de
    // submódulo: la RLS de `solicitudes_material` es el filtro real (privilegiados
    // ven todas; ingeniero solo las suyas). El parent ya deja pasar a los roles de
    // proyecto vía `puedeVerTodasRequisiciones`.
    path: 'requisiciones',
    loadComponent: () => import('./requisiciones/requisiciones').then((m) => m.Requisiciones),
    title: 'Requisiciones — Inventario',
  },
  {
    // BG4 — retiro de material dañado: solicitud → aprobación → conduce de retiro →
    // cuarentena (no despachable) → disposición. SIN gate de submódulo: la RLS de
    // retiros_material + los RPCs (puede_gestionar_retiro/puede_disponer_retiro) son
    // el filtro real (responsable de obra ve/crea los suyos; almacén gestiona).
    path: 'retiros',
    loadComponent: () => import('./retiros/retiros').then((m) => m.InventarioRetiros),
    title: 'Retiro de material dañado — Inventario',
  },
  // AU8 — 'por-firmar' se movió a ruta top-level (/por-firmar, gateada por
  // noChoferGuard) porque es un inbox personal que no debe heredar el guard del
  // módulo Inventario. Ver app.routes.ts. /inventario/por-firmar redirige allí.
  {
    // AU4 — bandeja de material no catalogado (admin/inventario; gate real server-side).
    path: 'material-no-catalogado',
    loadComponent: () =>
      import('./material-no-catalogado/material-no-catalogado').then((m) => m.MaterialNoCatalogado),
    title: 'Material no catalogado — Inventario',
  },
  {
    // AY13 — "Conduces por implementar": conduces con ≥1 item libre sin vincular.
    path: 'conduces-por-implementar',
    loadComponent: () =>
      import('./conduces-por-implementar/conduces-por-implementar').then((m) => m.ConducesPorImplementar),
    title: 'Conduces por implementar — Inventario',
  },
  {
    // BA/Transporte v3 — historial de conduces externos (proveedor de transporte).
    path: 'conduces-externos',
    canActivate: [submoduloGuard('inventario.salidas')],
    loadComponent: () => import('./conduces-externos/conduces-externos').then((m) => m.ConducesExternos),
    title: 'Conduces externos — Inventario',
  },
  {
    // BA/Transporte v3 — alta/emisión de conduce externo (gate real server-side: puede_crear_conduce).
    path: 'conduce-externo/nuevo',
    canActivate: [submoduloGuard('inventario.salidas')],
    loadComponent: () => import('./conduce-externo-form/conduce-externo-form').then((m) => m.ConduceExternoForm),
    title: 'Nuevo conduce externo — Inventario',
  },
  {
    // BA/Transporte v3 — catálogo + bandeja de ratificación (Raykler; gate server-side es_logistica).
    path: 'proveedores-transporte',
    loadComponent: () => import('./proveedores-transporte/proveedores-transporte').then((m) => m.ProveedoresTransporte),
    title: 'Proveedores de transporte — Inventario',
  },
  {
    // BA/Transporte v3 — bandeja "Lugares por registrar" (Raykler; gate server-side es_logistica).
    path: 'lugares-por-registrar',
    loadComponent: () => import('./lugares-por-registrar/lugares-por-registrar').then((m) => m.LugaresPorRegistrar),
    title: 'Lugares por registrar — Inventario',
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
    // AS10 — herramienta admin de apertura de inventario (piso inicial). El gate
    // real es server-side (set_apertura / set_apertura_lote son admin-only); el
    // componente también valida admin y redirige.
    path: 'apertura',
    loadComponent: () => import('./apertura/apertura').then((m) => m.AperturaInventario),
    title: 'Apertura de inventario — Inventario',
  },
  {
    // AT12 — "Ajuste real": fija el stock al listado real sin movimiento ni escalón.
    // Gate server-side (ajuste_real_stock/_lote son admin-only); el componente valida admin.
    path: 'ajuste-real',
    loadComponent: () => import('./ajuste-real/ajuste-real').then((m) => m.AjusteReal),
    title: 'Ajuste real — Inventario',
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
