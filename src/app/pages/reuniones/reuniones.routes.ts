import { Routes } from '@angular/router';

export const reunionesRoutes: Routes = [
  { path: '', loadComponent: () => import('./reuniones-lista/reuniones-lista').then((m) => m.ReunionesLista) },
  { path: ':id', loadComponent: () => import('./reunion-ficha/reunion-ficha').then((m) => m.ReunionFicha) },
];
