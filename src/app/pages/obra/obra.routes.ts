import { Routes } from '@angular/router';
import { submoduloGuard } from '../../core/guards/submodulo.guard';

/**
 * AG16 · Gestión de Producción de Obra. El parent NO usa moduleGuard: cada
 * submódulo se gatea con `submoduloGuard` (AG12), de modo que el capataz —sin el
 * módulo `obra` completo— entra solo a lo que su rol permite.
 */
export const obraRoutes: Routes = [
  { path: '', redirectTo: 'plan-dia', pathMatch: 'full' },
  {
    path: 'plan-dia',
    canActivate: [submoduloGuard('obra.plan_dia')],
    loadComponent: () => import('./plan-dia/plan-dia').then((m) => m.ObraPlanDia),
    title: 'Plan del día',
  },
  {
    path: 'no-conformidades',
    canActivate: [submoduloGuard('obra.no_conformidades')],
    loadComponent: () =>
      import('./no-conformidades/no-conformidades').then((m) => m.ObraNoConformidades),
    title: 'No conformidades e incidentes',
  },
  {
    path: 'checklists',
    canActivate: [submoduloGuard('obra.checklists')],
    loadComponent: () => import('./checklists/checklists').then((m) => m.ObraChecklists),
    title: 'Checklists de calidad',
  },
  {
    path: 'subcontratistas',
    canActivate: [submoduloGuard('obra.subcontratistas')],
    loadComponent: () => import('./subcontratistas/subcontratistas').then((m) => m.ObraSubcontratistas),
    title: 'Subcontratistas y cubicaciones',
  },
  {
    path: 'avance',
    canActivate: [submoduloGuard('obra.avance')],
    loadComponent: () => import('./avance/avance').then((m) => m.ObraAvance),
    title: 'Avance, costos y logística',
  },
  {
    path: 'informes',
    canActivate: [submoduloGuard('obra.informes')],
    loadComponent: () => import('./informes/informes').then((m) => m.ObraInformes),
    title: 'Informe semanal de obra',
  },
];
