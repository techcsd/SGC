import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  computed,
  OnInit,
  DestroyRef,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterOutlet, RouterLink, RouterLinkActive, Router, NavigationEnd } from '@angular/router';
import { NgOptimizedImage, NgTemplateOutlet } from '@angular/common';
import { AuthService } from '../../../app/core/services/auth.service';
import { UserService } from '../../../app/core/services/user.service';
import { NotificacionesService } from '../../services/notificaciones.service';
import { RealtimeNotificacionesService } from '../../services/realtime-notificaciones.service';
import { NotificacionesCentroService, Notif } from '../../services/notificaciones-centro.service';
import { OnboardingWeb } from '../onboarding-web/onboarding-web';
import { ConfirmDialog } from '../confirm-dialog/confirm-dialog';

interface NavItem {
  label: string;
  icon: string;
  route?: string;
  modulo?: string;
  /** Nav badge counter key, when it differs from `modulo` (e.g. Tareas has no
   *  module gate on the parent but still shows a per-user pending count). */
  badgeKey?: string;
  phase?: string;
  children?: NavSubItem[];
}

interface NavSubItem {
  label: string;
  route: string;
  /** When set, this child only renders if the user has the given module. */
  modulo?: string;
}

@Component({
  selector: 'app-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, NgOptimizedImage, NgTemplateOutlet, OnboardingWeb, ConfirmDialog],
  templateUrl: './shell.html',
  styleUrl: './shell.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Shell implements OnInit {
  private authService = inject(AuthService);
  private userService = inject(UserService);
  private router = inject(Router);
  private notificaciones = inject(NotificacionesService);
  private realtimeNotificaciones = inject(RealtimeNotificacionesService);
  private centro = inject(NotificacionesCentroService);
  private destroyRef = inject(DestroyRef);

  profile = this.userService.profile;
  avatarUrl = this.userService.avatarUrl;
  collapsed = signal(false);
  /** Mobile off-canvas drawer (≤768px); independent of the desktop `collapsed`. */
  mobileNavOpen = signal(false);
  expandedSection = signal<string | null>('inventario');

  // ── Notification center (header bell) ──
  notifItems = this.centro.items;
  notifNoLeidas = this.centro.noLeidas;
  notifOpen = signal(false);

  navItems: NavItem[] = [
    {
      label: 'Dashboard',
      icon: 'dashboard',
      route: '/dashboard',
    },
    {
      label: 'Dirección',
      icon: 'direccion',
      modulo: 'direccion',
      route: '/direccion',
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
        { label: 'Conduces', route: '/inventario/conduces' },
        { label: 'Conteos y ajustes', route: '/inventario/conteos' },
        { label: 'Reposición', route: '/inventario/reposicion' },
        { label: 'Almacenes', route: '/inventario/bodegas' },
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
        { label: 'Ausencias y vacaciones', route: '/rrhh/ausencias' },
        { label: 'Reportes', route: '/rrhh/reportes' },
      ],
    },
    {
      label: 'Proyectos',
      icon: 'projects',
      modulo: 'proyectos',
      children: [
        { label: 'Proyectos', route: '/proyectos' },
        { label: 'Ranking de Encargados', route: '/proyectos/kpi' },
        { label: 'Reportes de clima', route: '/proyectos/clima' },
        { label: 'Historial', route: '/proyectos/historial' },
      ],
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
        { label: 'Checklists', route: '/flota/checklists' },
        { label: 'Responsabilidad', route: '/flota/responsabilidad' },
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
        { label: 'Requisición', route: '/bitacora/solicitudes-material' },
        { label: 'Confirmar entregas', route: '/bitacora/entregas' },
      ],
    },
    {
      label: 'Documentos',
      icon: 'documentos',
      modulo: 'documentos',
      children: [
        { label: 'Generar documento', route: '/documentos/generar' },
        { label: 'Plantillas', route: '/documentos/plantillas', modulo: 'plantillas' },
        { label: 'Historial', route: '/documentos/historial' },
      ],
    },
    {
      label: 'Legal',
      icon: 'legal',
      modulo: 'legal',
      children: [
        { label: 'Expedientes', route: '/legal/expedientes' },
        { label: 'Contratos', route: '/legal/contratos' },
        { label: 'Aprobaciones', route: '/legal/aprobaciones' },
      ],
    },
    {
      // No `modulo`: visible to everyone (all users have "Mis tareas").
      // The "Gestión" child is gated to the 'tareas' module (managers).
      label: 'Tareas',
      icon: 'tareas',
      badgeKey: 'tareas',
      children: [
        { label: 'Mis tareas', route: '/tareas/mis-tareas' },
        { label: 'Gestión de tareas', route: '/tareas/gestion', modulo: 'tareas' },
        { label: 'Historial', route: '/tareas/historial' },
      ],
    },
    {
      // Sin `modulo`: la guía de homologación es informativa para todos.
      // Las secciones de gestión se gatean con el módulo 'tecnologia'.
      label: 'Tecnología',
      icon: 'tecnologia',
      children: [
        { label: 'Guía de herramientas', route: '/tecnologia/guia' },
        { label: 'Homologación', route: '/tecnologia/homologacion', modulo: 'tecnologia' },
        { label: 'Matriz puesto × herramienta', route: '/tecnologia/matriz', modulo: 'tecnologia' },
        { label: 'Inventario tecnológico', route: '/tecnologia/inventario', modulo: 'tecnologia' },
        { label: 'Compras tecnológicas', route: '/tecnologia/compras', modulo: 'tecnologia' },
      ],
    },
    {
      // Internal chat — no module gate, everyone can message.
      label: 'Mensajes',
      icon: 'mensajes',
      route: '/mensajes',
      badgeKey: 'mensajes',
    },
    {
      // App móvil de campo (APK Android + PWA iPhone) — visible para todos.
      label: 'CSD App (móvil)',
      icon: 'soporte',
      route: '/app-movil',
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
      { label: 'Unidades', route: '/admin/unidades' },
      { label: 'Catálogos de bitácora', route: '/admin/bitacora-catalogos' },
      { label: 'Parámetros', route: '/admin/parametros' },
      { label: 'Auditoría', route: '/admin/auditoria' },
      { label: 'Comentarios y Reportes', route: '/admin/reportes' },
    ],
  };

  isAdmin = computed(() => this.userService.hasRole('admin'));
  confirmLogoutOpen = signal(false);

  pendingBadge(item: NavItem): number {
    const key = item.badgeKey ?? item.modulo;
    if (!key) return 0;
    return this.notificaciones.pendingByModulo()[key] ?? 0;
  }

  canAccessChild(child: NavSubItem): boolean {
    if (!child.modulo) return true;
    return this.userService.hasModulo(child.modulo);
  }

  /** Stable anchor id for the first-run guided tour to spotlight this item. */
  tourKey(item: NavItem): string | null {
    if (item.route === '/app-movil') return 'csd-app';
    if (item.route === '/soporte') return 'soporte';
    return null;
  }

  ngOnInit() {
    const saved = localStorage.getItem('sgc-sidebar-collapsed');
    if (saved !== null) {
      this.collapsed.set(saved === 'true');
    }
    this.notificaciones.refresh();
    this.realtimeNotificaciones.start();

    // Notification center: load recent items + go live for this user.
    this.centro.cargar();
    const userId = this.userService.profile()?.id;
    if (userId) {
      this.centro.escuchar(userId);
    }

    // Catches any count-affecting mutation that doesn't already call
    // refresh() directly (belt-and-suspenders alongside the explicit calls
    // in solicitudes-material/compra.service.ts and salidas.service.ts).
    this.router.events.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((event) => {
      if (event instanceof NavigationEnd) {
        this.notificaciones.refresh();
        // Close the bell dropdown + mobile drawer when navigating away.
        this.notifOpen.set(false);
        this.mobileNavOpen.set(false);
      }
    });
  }

  toggleNotif() {
    this.notifOpen.update((v) => !v);
  }

  closeNotif() {
    this.notifOpen.set(false);
  }

  async abrirNotif(n: Notif) {
    this.notifOpen.set(false);
    await this.centro.marcarLeida(n.id);
    if (n.ruta) {
      this.router.navigate([n.ruta]);
    }
  }

  marcarTodasLeidas() {
    this.centro.marcarTodasLeidas();
  }

  /** Compact relative time in Spanish, e.g. "hace 5 min", "hace 2 h", "ayer". */
  tiempoRelativo(iso: string): string {
    const then = new Date(iso).getTime();
    const diffMs = Date.now() - then;
    const min = Math.floor(diffMs / 60000);
    if (min < 1) return 'ahora';
    if (min < 60) return `hace ${min} min`;
    const h = Math.floor(min / 60);
    if (h < 24) return `hace ${h} h`;
    const d = Math.floor(h / 24);
    if (d === 1) return 'ayer';
    if (d < 7) return `hace ${d} d`;
    return new Date(iso).toLocaleDateString('es-DO', { day: 'numeric', month: 'short' });
  }

  toggleCollapsed() {
    this.collapsed.update((v) => {
      const next = !v;
      localStorage.setItem('sgc-sidebar-collapsed', String(next));
      return next;
    });
  }

  toggleMobileNav() {
    this.mobileNavOpen.update((v) => !v);
  }

  closeMobileNav() {
    this.mobileNavOpen.set(false);
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

  /** Ask before signing out — a mis-click shouldn't drop the user's session. */
  requestLogout() {
    this.confirmLogoutOpen.set(true);
  }

  cancelLogout() {
    this.confirmLogoutOpen.set(false);
  }

  async logout() {
    this.confirmLogoutOpen.set(false);
    this.realtimeNotificaciones.stop();
    this.centro.stop();
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
