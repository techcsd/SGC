import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  computed,
  OnInit,
} from '@angular/core';
import { RouterOutlet, RouterLink, RouterLinkActive, Router, NavigationEnd } from '@angular/router';
import { NgOptimizedImage, NgTemplateOutlet } from '@angular/common';
import { AuthService } from '../../../app/core/services/auth.service';
import { UserService } from '../../../app/core/services/user.service';
import { NotificacionesService } from '../../services/notificaciones.service';

interface NavItem {
  label: string;
  icon: string;
  route?: string;
  modulo?: string;
  phase?: string;
  children?: NavSubItem[];
}

interface NavSubItem {
  label: string;
  route: string;
}

@Component({
  selector: 'app-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, NgOptimizedImage, NgTemplateOutlet],
  templateUrl: './shell.html',
  styleUrl: './shell.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Shell implements OnInit {
  private authService = inject(AuthService);
  private userService = inject(UserService);
  private router = inject(Router);
  private notificaciones = inject(NotificacionesService);

  profile = this.userService.profile;
  collapsed = signal(false);
  expandedSection = signal<string | null>('inventario');

  navItems: NavItem[] = [
    {
      label: 'Dashboard',
      icon: 'dashboard',
      route: '/dashboard',
    },
    {
      label: 'Inventario',
      icon: 'inventory',
      modulo: 'inventario',
      children: [
        { label: 'Artículos', route: '/inventario/articulos' },
        { label: 'Activos Fijos', route: '/inventario/activos' },
        { label: 'Entradas', route: '/inventario/entradas' },
        { label: 'Salidas', route: '/inventario/salidas' },
        { label: 'Bodegas', route: '/inventario/bodegas' },
        { label: 'Reportes', route: '/inventario/reportes' },
      ],
    },
    {
      label: 'Compras',
      icon: 'purchases',
      modulo: 'compras',
      children: [
        { label: 'Proveedores', route: '/compras/proveedores' },
        { label: 'Órdenes de Compra', route: '/compras/ordenes' },
        { label: 'Reportes', route: '/compras/reportes' },
      ],
    },
    {
      label: 'RRHH',
      icon: 'hr',
      modulo: 'rrhh',
      children: [
        { label: 'Empleados', route: '/rrhh/empleados' },
        { label: 'Asistencia', route: '/rrhh/asistencia' },
        { label: 'Reportes', route: '/rrhh/reportes' },
      ],
    },
    {
      label: 'Proyectos',
      icon: 'projects',
      modulo: 'proyectos',
      route: '/proyectos',
    },
    {
      label: 'Flota',
      icon: 'fleet',
      modulo: 'flota',
      children: [
        { label: 'Vehículos', route: '/flota/vehiculos' },
        { label: 'Mantenimientos', route: '/flota/mantenimientos' },
        { label: 'Conductores', route: '/flota/conductores' },
        { label: 'Combustible', route: '/flota/combustible' },
        { label: 'Rutas', route: '/flota/rutas' },
        { label: 'Reportes', route: '/flota/reportes' },
      ],
    },
    {
      label: 'Bitácora',
      icon: 'bitacora',
      modulo: 'bitacora',
      children: [
        { label: 'Nueva bitácora', route: '/bitacora/nueva' },
        { label: 'Mis bitácoras', route: '/bitacora/historial' },
        { label: 'Mi proyecto', route: '/bitacora/mi-proyecto' },
        { label: 'Solicitar materiales', route: '/bitacora/solicitudes-material' },
        { label: 'Solicitar compra', route: '/bitacora/solicitudes-compra' },
        { label: 'Confirmar entregas', route: '/bitacora/entregas' },
      ],
    },
    {
      label: 'Documentos',
      icon: 'documentos',
      modulo: 'documentos',
      children: [
        { label: 'Generar documento', route: '/documentos/generar' },
        { label: 'Plantillas', route: '/documentos/plantillas' },
        { label: 'Historial', route: '/documentos/historial' },
      ],
    },
    {
      label: 'Soporte',
      icon: 'soporte',
      route: '/soporte',
    },
    {
      label: 'Dudas',
      icon: 'dudas',
      route: '/dudas',
    },
  ];

  adminNavItem: NavItem = {
    label: 'Administración',
    icon: 'admin',
    modulo: 'admin',
    children: [
      { label: 'Usuarios', route: '/admin/usuarios' },
      { label: 'Roles', route: '/admin/roles' },
      { label: 'Comentarios y Reportes', route: '/admin/reportes' },
    ],
  };

  isAdmin = computed(() => this.userService.hasRole('admin'));

  pendingBadge(item: NavItem): number {
    if (!item.modulo) return 0;
    return this.notificaciones.pendingByModulo()[item.modulo] ?? 0;
  }

  ngOnInit() {
    const saved = localStorage.getItem('sgc-sidebar-collapsed');
    if (saved !== null) {
      this.collapsed.set(saved === 'true');
    }
    this.notificaciones.refresh();

    // Catches any count-affecting mutation that doesn't already call
    // refresh() directly (belt-and-suspenders alongside the explicit calls
    // in solicitudes-material/compra.service.ts and salidas.service.ts).
    this.router.events.subscribe((event) => {
      if (event instanceof NavigationEnd) {
        this.notificaciones.refresh();
      }
    });
  }

  toggleCollapsed() {
    this.collapsed.update((v) => {
      const next = !v;
      localStorage.setItem('sgc-sidebar-collapsed', String(next));
      return next;
    });
  }

  toggleSection(label: string) {
    this.expandedSection.update((current) => (current === label ? null : label));
  }

  isSectionExpanded(label: string) {
    return this.expandedSection() === label;
  }

  canAccess(item: NavItem): boolean {
    if (!item.modulo) return true;
    if (item.phase) return false;
    return this.userService.hasModulo(item.modulo);
  }

  async logout() {
    await this.authService.signOut();
    this.userService.clearProfile();
    this.notificaciones.clear();
    this.router.navigate(['/auth']);
  }

  getUserInitials(): string {
    const nombre = this.profile()?.nombre ?? '';
    return nombre
      .split(' ')
      .slice(0, 2)
      .map((w) => w[0])
      .join('')
      .toUpperCase();
  }
}
