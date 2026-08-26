import { Routes } from '@angular/router';
import { submoduloGuard } from '../../core/guards/submodulo.guard';
import { submoduloOperarGuard } from '../../core/guards/submodulo-operar.guard';
import { proyectosGestionGuard } from '../../core/guards/proyectos-gestion.guard';

// AR1 — El parent (/proyectos) pasa a moduloOSubmoduloGuard, así que cada hija se
// afina con su submódulo. Quien tenga el MÓDULO completo pasa por compat; un rol
// granular (p. ej. sólo 'proyectos.personal') sólo entra a sus rutas.
export const proyectosRoutes: Routes = [
  {
    path: '',
    canActivate: [submoduloGuard('proyectos.obras')],
    loadComponent: () => import('./lista/lista').then((m) => m.Lista),
    title: 'Proyectos',
  },
  {
    // Z13 — crear proyecto como ruta dedicada (deep-linkable, botón Atrás).
    // AY4c — solo quien GESTIONA proyectos (el Ingeniero de Oficina no).
    path: 'nuevo',
    canActivate: [proyectosGestionGuard],
    loadComponent: () => import('./lista/lista').then((m) => m.Lista),
    data: { modo: 'crear' },
    title: 'Nuevo proyecto',
  },
  {
    path: 'kpi',
    canActivate: [submoduloGuard('proyectos.ranking')],
    loadComponent: () => import('./kpi/kpi').then((m) => m.Kpi),
    title: 'Ranking de Encargados — Proyectos',
  },
  {
    path: 'historial',
    canActivate: [submoduloGuard('proyectos.obras')],
    loadComponent: () => import('./historial/historial').then((m) => m.ProyectosHistorial),
    title: 'Historial de proyectos',
  },
  {
    path: 'clima',
    canActivate: [submoduloGuard('proyectos.obras')],
    loadComponent: () => import('./clima/clima').then((m) => m.ProyectosClima),
    title: 'Reportes de clima — Proyectos',
  },
  // AR1 — Personal de obra (submódulo proyectos.personal). Antes del ':id'.
  {
    path: 'personal',
    canActivate: [submoduloGuard('proyectos.personal')],
    loadComponent: () => import('./personal/personal').then((m) => m.PersonalObraLista),
    title: 'Personal de obra',
  },
  {
    path: 'personal/registrar',
    canActivate: [submoduloGuard('proyectos.personal')],
    loadComponent: () => import('./personal/personal-registro').then((m) => m.PersonalRegistro),
    title: 'Registrar personal',
  },
  {
    // AT5 — Import de personal desde Excel. Antes del ':id'.
    path: 'personal/importar',
    canActivate: [submoduloGuard('proyectos.personal')],
    loadComponent: () => import('./personal/personal-import').then((m) => m.PersonalImport),
    title: 'Importar personal',
  },
  {
    path: 'personal/:id',
    canActivate: [submoduloGuard('proyectos.personal')],
    loadComponent: () => import('./personal/personal-expediente').then((m) => m.PersonalExpediente),
    title: 'Expediente de personal',
  },
  {
    // Y15 — Cronograma de un proyecto (deep-linkable desde avisos/emails).
    path: ':id/cronograma',
    canActivate: [submoduloGuard('proyectos.cronograma')],
    loadComponent: () => import('./cronograma/cronograma').then((m) => m.Cronograma),
    title: 'Cronograma — Proyectos',
  },
  {
    // AS21 — importar cronograma desde Excel (.mpp → exportar a Excel primero).
    path: ':id/cronograma/importar',
    canActivate: [submoduloGuard('proyectos.cronograma')],
    loadComponent: () => import('./cronograma-import/cronograma-import').then((m) => m.CronogramaImport),
    title: 'Importar cronograma — Proyectos',
  },
  {
    // AA23 QW4 — reporte de costo de material real por obra.
    // AY4 — costos es OPERAR: un ingeniero con `proyectos.obras=ver` ve la ficha
    // pero NO los costos (decisión Xaviel: costos quedan para oficina/gerencia).
    path: ':id/costos',
    canActivate: [submoduloOperarGuard('proyectos.obras')],
    loadComponent: () => import('./costos/costos').then((m) => m.ProyectoCostos),
    title: 'Costo de material — Proyectos',
  },
  {
    // AH15 — compras (órdenes de compra + ferretería) ligadas a la obra.
    // AY4 — vista financiera de compras de la obra = OPERAR (ver arriba).
    path: ':id/compras',
    canActivate: [submoduloOperarGuard('proyectos.obras')],
    loadComponent: () => import('./compras/compras').then((m) => m.ProyectoCompras),
    title: 'Compras — Proyectos',
  },
  {
    // Z13 — detalle del proyecto como ruta dedicada (deep-linkable, botón Atrás).
    path: ':id',
    canActivate: [submoduloGuard('proyectos.obras')],
    loadComponent: () => import('./lista/lista').then((m) => m.Lista),
    title: 'Proyecto',
  },
];
