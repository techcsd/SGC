import { Routes } from '@angular/router';
import { moduleGuard } from '../../core/guards/module.guard';

export const tareasRoutes: Routes = [
  { path: '', redirectTo: 'mis-tareas', pathMatch: 'full' },
  // Any authenticated user can see the tasks assigned to them.
  { path: 'mis-tareas', loadComponent: () => import('./mis-tareas/mis-tareas').then((m) => m.MisTareas) },
  // Only managers (roles with the 'tareas' module) can assign and track all tasks.
  {
    path: 'gestion',
    canActivate: [moduleGuard('tareas')],
    loadComponent: () => import('./gestion/gestion').then((m) => m.Gestion),
  },
  // History is visible to everyone (RLS scopes: own tasks, or all for managers).
  {
    path: 'historial',
    loadComponent: () => import('./historial/historial').then((m) => m.TareasHistorial),
  },
];
