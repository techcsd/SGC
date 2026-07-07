import { Routes } from '@angular/router';
import { moduleGuard } from '../../core/guards/module.guard';

export const documentosRoutes: Routes = [
  { path: '', redirectTo: 'generar', pathMatch: 'full' },
  { path: 'generar', loadComponent: () => import('./generar/generar').then((m) => m.Generar) },
  {
    // Creating/editing templates is gated to the 'plantillas' module; generating
    // documents (above) only needs 'documentos'.
    path: 'plantillas',
    canActivate: [moduleGuard('plantillas')],
    loadComponent: () => import('./plantillas/plantillas').then((m) => m.Plantillas),
  },
  { path: 'historial', loadComponent: () => import('./historial/historial').then((m) => m.Historial) },
  { path: 'ver/:id', loadComponent: () => import('./ver/ver').then((m) => m.Ver) },
];
