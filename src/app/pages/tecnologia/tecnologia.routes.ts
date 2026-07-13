import { Routes } from '@angular/router';
import { moduleGuard } from '../../core/guards/module.guard';

export const tecnologiaRoutes: Routes = [
  { path: '', redirectTo: 'guia', pathMatch: 'full' },
  // Guía de homologación: informativa para TODO usuario autenticado (sin gate de módulo).
  {
    path: 'guia',
    loadComponent: () => import('./guia/guia').then((m) => m.TecGuia),
    title: 'Homologación — Tecnología',
  },
  // Gestión: gateada por el módulo 'tecnologia'.
  {
    path: 'homologacion',
    canActivate: [moduleGuard('tecnologia')],
    loadComponent: () => import('./homologacion/homologacion').then((m) => m.TecHomologacion),
    title: 'Herramientas — Tecnología',
  },
  {
    path: 'matriz',
    canActivate: [moduleGuard('tecnologia')],
    loadComponent: () => import('./matriz/matriz').then((m) => m.TecMatriz),
    title: 'Matriz puesto × herramienta — Tecnología',
  },
  {
    path: 'inventario',
    canActivate: [moduleGuard('tecnologia')],
    loadComponent: () => import('./inventario/inventario').then((m) => m.TecInventario),
    title: 'Inventario tecnológico — Tecnología',
  },
  {
    path: 'compras',
    canActivate: [moduleGuard('tecnologia')],
    loadComponent: () => import('./compras/compras').then((m) => m.TecCompras),
    title: 'Compras tecnológicas — Tecnología',
  },
];
