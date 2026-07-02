import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  computed,
  OnInit,
} from '@angular/core';
import { RouterOutlet, RouterLink, RouterLinkActive, Router } from '@angular/router';
import { NgOptimizedImage, NgTemplateOutlet } from '@angular/common';
import { AuthService } from '../../../app/core/services/auth.service';
import { UserService } from '../../../app/core/services/user.service';
import { SupabaseService } from '../../../app/core/services/supabase.service';

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
  private supabase = inject(SupabaseService);

  profile = this.userService.profile;
  collapsed = signal(false);
  expandedSection = signal<string | null>('inventario');

  /** Pending-solicitud counts per module, for the red-dot nav badge. */
  private pendingByModulo = signal<Record<string, number>>({});

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
  ];

  adminNavItem: NavItem = {
    label: 'Administración',
    icon: 'admin',
    modulo: 'admin',
    children: [
      { label: 'Usuarios', route: '/admin/usuarios' },
      { label: 'Roles', route: '/admin/roles' },
    ],
  };

  isAdmin = computed(() => this.userService.hasRole('admin'));

  ngOnInit() {
    const saved = localStorage.getItem('sgc-sidebar-collapsed');
    if (saved !== null) {
      this.collapsed.set(saved === 'true');
    }
    this.loadPendingBadges();
  }

  private async loadPendingBadges() {
    const checks: Promise<void>[] = [];

    if (this.userService.hasModulo('inventario') || this.isAdmin()) {
      checks.push(this.loadPendingCount('solicitudes_material', 'inventario'));
    }
    if (this.userService.hasModulo('compras') || this.isAdmin()) {
      checks.push(this.loadPendingCount('solicitudes_compra', 'compras'));
    }

    await Promise.all(checks);
  }

  private async loadPendingCount(table: string, modulo: string): Promise<void> {
    const { count } = await this.supabase.client
      .from(table)
      .select('id', { count: 'exact', head: true })
      .eq('estado', 'pendiente');
    this.pendingByModulo.update((m) => ({ ...m, [modulo]: count ?? 0 }));
  }

  pendingBadge(item: NavItem): number {
    if (!item.modulo) return 0;
    return this.pendingByModulo()[item.modulo] ?? 0;
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
