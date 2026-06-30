import { Routes } from '@angular/router';

export const proyectosRoutes: Routes = [
  {
    path: '',
    loadComponent: () => import('./lista/lista').then((m) => m.Lista),
    title: 'Proyectos',
  },
];
