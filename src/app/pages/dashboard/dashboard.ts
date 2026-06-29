import { Component, ChangeDetectionStrategy, inject, computed } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NgTemplateOutlet } from '@angular/common';
import { UserService } from '../../core/services/user.service';

interface ModuleCard {
  label: string;
  description: string;
  route: string;
  modulo: string;
  icon: string;
  phase?: string;
  color: string;
}

@Component({
  selector: 'app-dashboard',
  imports: [RouterLink, NgTemplateOutlet],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Dashboard {
  private userService = inject(UserService);

  profile = this.userService.profile;

  allModules: ModuleCard[] = [
    {
      label: 'Inventario',
      description: 'Artículos, activos, entradas, salidas y bodegas.',
      route: '/inventario',
      modulo: 'inventario',
      icon: 'inventory',
      color: '#1F4E79',
    },
    {
      label: 'Compras',
      description: 'Solicitudes, cotizaciones y órdenes de compra.',
      route: '/compras',
      modulo: 'compras',
      icon: 'purchases',
      phase: 'Fase 2',
      color: '#5B3A8E',
    },
    {
      label: 'RRHH',
      description: 'Empleados, contratos, ausencias y planilla.',
      route: '/rrhh',
      modulo: 'rrhh',
      icon: 'hr',
      phase: 'Fase 2',
      color: '#2D7D46',
    },
    {
      label: 'Proyectos',
      description: 'Obras en ejecución, cronogramas y recursos.',
      route: '/proyectos',
      modulo: 'proyectos',
      icon: 'projects',
      phase: 'Fase 2',
      color: '#B45309',
    },
    {
      label: 'Flota',
      description: 'Vehículos, maquinaria y mantenimiento.',
      route: '/flota',
      modulo: 'flota',
      icon: 'fleet',
      phase: 'Fase 3',
      color: '#C0392B',
    },
  ];

  isAdmin = computed(() => this.userService.hasRole('admin'));

  canAccess(modulo: string): boolean {
    return this.userService.hasModulo(modulo) || this.userService.hasRole('admin');
  }

  getGreeting(): string {
    const nombre = this.profile()?.nombre?.split(' ')[0] ?? 'Usuario';
    return `Bienvenido, ${nombre}`;
  }
}
