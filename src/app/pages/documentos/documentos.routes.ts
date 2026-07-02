import { Routes } from '@angular/router';

export const documentosRoutes: Routes = [
  { path: '', redirectTo: 'generar', pathMatch: 'full' },
  { path: 'generar', loadComponent: () => import('./generar/generar').then((m) => m.Generar) },
  { path: 'plantillas', loadComponent: () => import('./plantillas/plantillas').then((m) => m.Plantillas) },
  { path: 'historial', loadComponent: () => import('./historial/historial').then((m) => m.Historial) },
  { path: 'ver/:id', loadComponent: () => import('./ver/ver').then((m) => m.Ver) },
];
