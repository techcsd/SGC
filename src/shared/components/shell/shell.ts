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
import { AppVersionesService } from '../../services/app-versiones.service';
import { DatosPruebaViewService } from '../../services/datos-prueba-view.service';
import { ActividadService } from '../../services/actividad.service';
import { ModuloOrdenService } from '../../services/modulo-orden.service';
import { OnboardingWeb } from '../onboarding-web/onboarding-web';
import { ConfirmDialog } from '../confirm-dialog/confirm-dialog';
import { formatFechaRelativa } from '../../utils/fecha.util';

interface NavItem {
  label: string;
  icon: string;
  route?: string;
  modulo?: string;
  /** Nav badge counter key, when it differs from `modulo` (e.g. Tareas has no
   *  module gate on the parent but still shows a per-user pending count). */
  badgeKey?: string;
  phase?: string;
  /** AC2 — oculto para la persona "chofer" (rol chofer_transportista). */
  noChofer?: boolean;
  /** AL1 — grupo de plataforma "Sistema": solo admin | rol tecnologia | gerencia | dirección. */
  soloTecnologia?: boolean;
  /** AF32 — visible además para roles de flota elevados aunque no tengan el módulo
   *  (el jefe de flota entra a Compras SOLO por Proveedores). */
  flotaElevado?: boolean;
  /** AG12 — visible si el usuario puede VER alguno de estos submódulos (permiso
   *  granular), aunque no tenga el módulo padre. */
  submodulos?: string[];
  /** AT (PROMPT-4) — módulo EXTRA que también hace visible el grupo aunque no
   *  tenga el módulo padre (p. ej. Flota visible para quien tiene `incentivos`,
   *  para llegar a "Desempeño de choferes"). Cada hija sigue con su propio gate. */
  extraModulo?: string;
  /** AU1 — bandeja personal que solo aparece cuando hay algo pendiente (badge>0).
   *  P. ej. "Conduces por firmar": cualquier usuario puede ser despachante. */
  soloConPendiente?: boolean;
  /** AU6 — el grupo se muestra si el usuario puede ver AL MENOS un hijo (en vez de
   *  gatear por un módulo padre). Para paraguas como "Ingeniería" que agrupan hijos
   *  con permisos distintos, sin que nadie pierda acceso ni se muestre un grupo vacío. */
  showIfAnyChild?: boolean;
  /** AV2 — visible SOLO para estos roles (por roles.codigo). Para vistas que aplican
   *  a un rol específico y a nadie más (p. ej. "Mi rendimiento" = Chofer + Jefe de flota),
   *  aunque el admin no lo vea. Se evalúa con la misma matriz de roles del UserService. */
  soloRoles?: string[];
  children?: NavSubItem[];
}

interface NavSubItem {
  label: string;
  route: string;
  /** When set, this child only renders if the user has the given module. */
  modulo?: string;
  /** R5 — clave del conteo desglosado por submódulo (pendingBySubmodulo). */
  badgeKey?: string;
  /** R14 — solo visible para roles de flota elevados (no el chofer). */
  flotaElevado?: boolean;
  /** Y11 — solo visible para admin | rol tecnologia (módulo Tecnología de plataforma). */
  soloTecnologia?: boolean;
  /** AS10 — solo visible para admin (herramientas admin como Apertura). */
  soloAdmin?: boolean;
  /** AG12 — visible si el usuario puede VER este submódulo (permiso granular). */
  submodulo?: string;
  /** AS7 — bandeja global de requisiciones: módulo inventario o roles de proyecto. */
  verTodasRequisiciones?: boolean;
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
  private appVersiones = inject(AppVersionesService);
  private datosPruebaView = inject(DatosPruebaViewService);
  private actividad = inject(ActividadService);
  private moduloOrden = inject(ModuloOrdenService);
  private destroyRef = inject(DestroyRef);

  // AF38 — orden configurable del menú (vacío = orden por defecto del array).
  private ordenMap = signal<Record<string, number>>({});
  /** navItems ordenados según la configuración; estable (fallback a la posición original). */
  orderedNavItems = computed(() => {
    const map = this.ordenMap();
    if (!Object.keys(map).length) return this.navItems;
    return this.navItems
      .map((item, i) => ({ item, i }))
      .sort((a, b) => {
        const oa = map[a.item.label] ?? (1000 + a.i);
        const ob = map[b.item.label] ?? (1000 + b.i);
        return oa - ob || a.i - b.i;
      })
      .map((x) => x.item);
  });

  profile = this.userService.profile;
  avatarUrl = this.userService.avatarUrl;

  // W7 — banner persistente de datos de prueba (solo admin).
  esAdmin = computed(() => this.userService.hasRole('admin'));
  verPrueba = this.datosPruebaView.ver;
  ocultarPrueba = () => this.datosPruebaView.set(false);
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
      // AY2 — "Dirección" se renombra a "Gerencia" en la UI. La clave del módulo
      // sigue siendo 'direccion' (rutas, guards, RLS tiene_modulo('direccion')).
      label: 'Gerencia',
      icon: 'direccion',
      modulo: 'direccion',
      route: '/direccion',
    },
    {
      label: 'Inventario',
      icon: 'inventory',
      modulo: 'inventario',
      // AN2 — visible con el módulo completo O cualquier submódulo granular.
      submodulos: ['inventario.articulos', 'inventario.entradas', 'inventario.salidas', 'inventario.conteos'],
      children: [
        { label: 'Artículos', route: '/inventario/articulos', submodulo: 'inventario.articulos' },
        { label: 'Categorías', route: '/inventario/categorias', submodulo: 'inventario.articulos' },
        { label: 'Activos Fijos', route: '/inventario/activos', submodulo: 'inventario.articulos' },
        { label: 'Entradas', route: '/inventario/entradas', submodulo: 'inventario.entradas' },
        { label: 'Salidas', route: '/inventario/salidas', submodulo: 'inventario.salidas' },
        { label: 'Requisiciones', route: '/inventario/requisiciones', verTodasRequisiciones: true, badgeKey: 'inventario.requisiciones' },
        { label: 'Movimientos', route: '/inventario/movimientos', submodulo: 'inventario.articulos' },
        { label: 'Conduces', route: '/inventario/conduces', submodulo: 'inventario.salidas' },
        { label: 'Confirmaciones de entrega', route: '/inventario/confirmaciones', submodulo: 'inventario.salidas' },
        { label: 'Material no catalogado', route: '/inventario/material-no-catalogado', modulo: 'inventario', badgeKey: 'inventario.material_no_catalogado' },
        { label: 'Conduces por implementar', route: '/inventario/conduces-por-implementar', modulo: 'inventario', badgeKey: 'inventario.conduces_por_implementar' },
        { label: 'Conteos y ajustes', route: '/inventario/conteos', submodulo: 'inventario.conteos' },
        { label: 'Apertura de inventario', route: '/inventario/apertura', soloAdmin: true },
        { label: 'Reposición', route: '/inventario/reposicion', submodulo: 'inventario.articulos' },
        { label: 'Almacenes', route: '/inventario/bodegas', submodulo: 'inventario.articulos' },
        { label: 'Reportes', route: '/inventario/reportes', submodulo: 'inventario.salidas' },
      ],
    },
    {
      label: 'Compras',
      icon: 'purchases',
      modulo: 'compras',
      flotaElevado: true, // AF32 — jefe de flota entra SOLO a Proveedores
      submodulos: ['compras.proveedores'], // AG12 — visible con permiso granular
      children: [
        { label: 'Proveedores', route: '/compras/proveedores', submodulo: 'compras.proveedores' },
        { label: 'Órdenes de Compra', route: '/compras/ordenes', submodulo: 'compras.ordenes', badgeKey: 'compras.ordenes' },
        { label: 'Reportes', route: '/compras/reportes', modulo: 'compras' },
      ],
    },
    {
      label: 'RRHH',
      icon: 'hr',
      modulo: 'rrhh',
      children: [
        { label: 'Empleados', route: '/rrhh/empleados' },
        { label: 'Asistencia', route: '/rrhh/asistencia' },
        { label: 'Ausencias y vacaciones', route: '/rrhh/ausencias', badgeKey: 'rrhh.ausencias' },
        { label: 'Reportes', route: '/rrhh/reportes' },
      ],
    },
    {
      label: 'Proyectos',
      icon: 'projects',
      modulo: 'proyectos',
      // AR1 — visible con el módulo completo O cualquier submódulo granular
      // (p. ej. un capataz con sólo 'proyectos.personal').
      submodulos: ['proyectos.obras', 'proyectos.cronograma', 'proyectos.ranking', 'proyectos.personal'],
      children: [
        { label: 'Proyectos', route: '/proyectos', submodulo: 'proyectos.obras' },
        { label: 'Personal de obra', route: '/proyectos/personal', submodulo: 'proyectos.personal' },
        { label: 'Ranking de Encargados', route: '/proyectos/kpi', submodulo: 'proyectos.ranking' },
        { label: 'Reportes de clima', route: '/proyectos/clima', submodulo: 'proyectos.obras' },
        { label: 'Historial', route: '/proyectos/historial', submodulo: 'proyectos.obras' },
      ],
    },
    {
      label: 'Flota',
      icon: 'fleet',
      modulo: 'flota',
      // AN2 — visible con el módulo completo O cualquier submódulo granular.
      // (Los ítems `flotaElevado` no se relajan: siguen sólo para roles elevados.)
      submodulos: ['flota.vehiculos', 'flota.mantenimientos', 'flota.combustible', 'flota.rutas'],
      // AT (PROMPT-4) — quien tiene el módulo `incentivos` (Logística, Gerencia,
      // Admin) ve Flota para llegar a "Desempeño de choferes", aunque no tenga flota.
      extraModulo: 'incentivos',
      children: [
        { label: 'Vehículos', route: '/flota/vehiculos', submodulo: 'flota.vehiculos' },
        { label: 'Mantenimientos', route: '/flota/mantenimientos', badgeKey: 'flota.mantenimientos', submodulo: 'flota.mantenimientos' },
        // P3 — "Estado de conductores" es ahora una pestaña dentro de Conductores.
        { label: 'Conductores', route: '/flota/conductores', flotaElevado: true },
        // P3 — Seguimiento agrupa Mapa/Rutas activas/Recorrido diario en pestañas (app-flota-subnav).
        { label: 'Seguimiento', route: '/flota/seguimiento', flotaElevado: true },
        // P3 — Combustible agrupa Registro/Echadas/Dashboards/Conciliación en pestañas.
        { label: 'Combustible', route: '/flota/combustible', badgeKey: 'flota.combustible', submodulo: 'flota.combustible' },
        // Conciliación queda también como ítem propio por su badge de pendientes (auditoría).
        { label: 'Conciliación de combustible', route: '/flota/conciliacion-combustible', flotaElevado: true, badgeKey: 'flota.conciliacion' },
        { label: 'Rutas', route: '/flota/rutas', submodulo: 'flota.rutas' },
        { label: 'Checklists', route: '/flota/checklists', badgeKey: 'flota.checklists', submodulo: 'flota.vehiculos' },
        { label: 'Inspección vehículo', route: '/flota/reporte-semanal', badgeKey: 'flota.reporte-semanal', submodulo: 'flota.vehiculos' },
        { label: 'Panel del día', route: '/flota/panel-dia', flotaElevado: true },
        { label: 'Avisos', route: '/flota/avisos', badgeKey: 'flota.avisos', submodulo: 'flota.vehiculos' },
        { label: 'Accidentes', route: '/flota/accidentes', flotaElevado: true },
        { label: 'Vehículos en uso', route: '/flota/responsabilidad', flotaElevado: true },
        { label: 'Reportes', route: '/flota/reportes', flotaElevado: true },
        // AT1-AT3 (PROMPT-4) — Incentivos (gestión) movido DENTRO de Flota › Desempeño.
        // Gateado por el módulo `incentivos` (Logística y Transportación, Gerencia, Admin).
        { label: 'Desempeño de choferes', route: '/incentivos', modulo: 'incentivos' },
      ],
    },
    {
      // AT2/AV2 — "Mi rendimiento": vista personal del incentivo. SOLO Chofer y Jefe
      // de flota (los roles del incentivo); el admin usa las vistas administrativas
      // en /incentivos (Desempeño de choferes), no esta. La RLS ya limita a lo suyo.
      label: 'Mi rendimiento',
      icon: 'incentivos',
      route: '/mi-rendimiento',
      soloRoles: ['chofer_transportista', 'jefe_flota'],
    },
    // AU6 — "Producción de Obra" y "Bitácora" ya NO son grupos top-level: se movieron
    // dentro del módulo "Ingeniería" (ver el grupo Ingeniería más abajo). Las rutas y
    // los permisos (`obra.*`, `bitacora`) se conservan intactos — solo cambia dónde
    // aparecen en el menú. Cada hijo mantiene su gate granular (visibilidad por submódulo).
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
        { label: 'Aprobaciones', route: '/legal/aprobaciones', badgeKey: 'legal.aprobaciones' },
      ],
    },
    {
      // AU1 — bandeja del despachante: aparece SOLO cuando tienes conduces por firmar.
      // AU8 — pero NUNCA para un chofer: un chofer no firma/confirma entregas; solo
      // el ingeniero de obra / rol elevado que aprueba la entrega tiene acceso. El
      // chofer registra la entrega y un rol elevado la confirma y firma.
      label: 'Conduces por firmar',
      icon: 'inventory',
      route: '/por-firmar',
      badgeKey: 'conduces.por_firmar',
      soloConPendiente: true,
      noChofer: true,
    },
    {
      // AT6/AU6 — módulo "Ingeniería" como paraguas de las herramientas del ingeniero:
      // Solicitud de movimiento + Bitácora + Producción de Obra. `showIfAnyChild` hace
      // que el grupo aparezca si el usuario puede ver AL MENOS un hijo (así nadie con
      // `bitacora`/`obra.*` pierde acceso aunque no tenga el módulo `ingenieria`). Cada
      // hijo conserva su gate granular → NO todos los submódulos se ven con solo tener
      // acceso a Ingeniería (regla de Xaviel). Rutas y permisos intactos (RLS-safe).
      label: 'Ingeniería',
      icon: 'ingenieria',
      showIfAnyChild: true,
      children: [
        { label: 'Solicitud de movimiento', route: '/solicitudes-movimiento', badgeKey: 'solicitudes_movimiento', modulo: 'ingenieria' },
        // Bitácora (módulo `bitacora`)
        { label: 'Nueva bitácora', route: '/bitacora/nueva', modulo: 'bitacora' },
        { label: 'Mis bitácoras', route: '/bitacora/historial', modulo: 'bitacora' },
        { label: 'Dashboard de bitácora', route: '/bitacora/dashboard', modulo: 'bitacora' },
        { label: 'Mi proyecto', route: '/bitacora/mi-proyecto', modulo: 'bitacora' },
        { label: 'Requisición', route: '/bitacora/solicitudes-material', modulo: 'bitacora' },
        { label: 'Confirmar entregas', route: '/bitacora/entregas', modulo: 'bitacora' },
        // Producción de Obra (submódulos granulares `obra.*`)
        { label: 'Plan del día', route: '/obra/plan-dia', submodulo: 'obra.plan_dia' },
        { label: 'No conformidades', route: '/obra/no-conformidades', submodulo: 'obra.no_conformidades' },
        { label: 'Checklists de calidad', route: '/obra/checklists', submodulo: 'obra.checklists' },
        { label: 'Subcontratistas', route: '/obra/subcontratistas', submodulo: 'obra.subcontratistas' },
        { label: 'Avance y costos', route: '/obra/avance', submodulo: 'obra.avance' },
        { label: 'Informe semanal de obra', route: '/obra/informes', submodulo: 'obra.informes' },
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
      // AL1 — Tecnología REAL = activos/servicios de TI. Gateado por el módulo
      // `tecnologia` (+ admin), ya no visible para todo usuario no-chofer.
      label: 'Tecnología',
      icon: 'tecnologia',
      modulo: 'tecnologia',
      children: [
        { label: 'Inventario tecnológico', route: '/tecnologia/inventario', modulo: 'tecnologia' },
        { label: 'Guía de herramientas', route: '/tecnologia/guia', modulo: 'tecnologia' },
        { label: 'Homologación', route: '/tecnologia/homologacion', modulo: 'tecnologia' },
        { label: 'Matriz puesto × herramienta', route: '/tecnologia/matriz', modulo: 'tecnologia' },
        { label: 'Compras tecnológicas', route: '/tecnologia/compras', modulo: 'tecnologia' },
        // AW9 — Monitoreo de infraestructura pasa a Tecnología (antes vivía en
        // "Sistema"). Gateado por el módulo tecnologia, alineado con su RLS
        // (es_tecnologia = admin OR módulo tecnologia).
        { label: 'Monitoreo de infraestructura', route: '/tecnologia/monitoreo', modulo: 'tecnologia' },
        { label: 'APIs y consumo', route: '/tecnologia/apis-consumo', modulo: 'tecnologia' },
      ],
    },
    {
      // AL1 — "Sistema" = consola de plataforma/DevOps (lo que ANTES vivía dentro
      // de "Tecnología" pero no es TI de activos). Solo es_tecnologia
      // (admin | tecnologia | gerencia | dirección).
      label: 'Sistema',
      icon: 'tecnologia',
      soloTecnologia: true,
      children: [
        { label: 'Historial de versiones', route: '/tecnologia/historial-versiones', soloTecnologia: true },
        { label: 'Versiones de la app', route: '/tecnologia/app-versiones', soloTecnologia: true },
        { label: 'QA (pruebas)', route: '/tecnologia/qa', soloTecnologia: true },
        { label: 'Estadísticas', route: '/tecnologia/estadisticas', soloTecnologia: true },
        { label: 'Reportes de errores', route: '/tecnologia/reportes-errores', soloTecnologia: true },
        { label: 'Issues (Jira interno)', route: '/tecnologia/issues', soloTecnologia: true },
      ],
    },
    {
      // AW4 — Tato, asistente de IA. Sin gate de módulo (hereda permisos del usuario).
      label: 'Tato (asistente)',
      icon: 'tato',
      route: '/asistente',
    },
    {
      // Internal chat — no module gate, everyone can message.
      label: 'Mensajes',
      icon: 'mensajes',
      route: '/mensajes',
      badgeKey: 'mensajes',
    },
    {
      // Personal + shared notes — no module gate, visible to everyone.
      label: 'Notas',
      icon: 'notas',
      route: '/notas',
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
      badgeKey: 'soporte',
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
      { label: 'Empresa', route: '/admin/empresa' },
      { label: 'Unidades', route: '/admin/unidades' },
      { label: 'Catálogos de bitácora', route: '/admin/bitacora-catalogos' },
      { label: 'Parámetros', route: '/admin/parametros' },
      // Y11 — "Versiones de la app" e "Historial de versiones" movidas al módulo Tecnología.
      { label: 'Valores "Otro"', route: '/admin/otros-valores' },
      { label: 'Notificaciones', route: '/admin/notificaciones' },
      { label: 'Matriz de notificaciones', route: '/admin/matriz-notificaciones' },
      { label: 'Orden de módulos', route: '/admin/orden-modulos' },
      { label: 'Almacenes duplicados', route: '/admin/almacenes-duplicados' },
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
    // R14 — submódulos de flota solo para roles elevados (oculto al chofer).
    if (child.flotaElevado && !this.userService.esFlotaElevado()) return false;
    // Y11 — submódulos de plataforma solo para admin | rol tecnologia.
    if (child.soloTecnologia && !this.userService.esTecnologia()) return false;
    // AS10 — herramientas admin (Apertura de inventario).
    if (child.soloAdmin && !this.userService.hasRole('admin')) return false;
    // AS7 — bandeja global de requisiciones (inventario o roles de proyecto).
    if (child.verTodasRequisiciones) return this.userService.puedeVerTodasRequisiciones();
    // AG12 — submódulo con permiso granular (p. ej. Proveedores).
    if (child.submodulo) {
      return this.userService.esFlotaElevado() || this.userService.puedeVerSubmodulo(child.submodulo);
    }
    if (!child.modulo) return true;
    return this.userService.hasModulo(child.modulo);
  }

  /** R5 — badge de un submódulo (nav-child) desde el conteo desglosado. */
  childBadge(child: NavSubItem): number {
    if (!child.badgeKey) return 0;
    return this.notificaciones.pendingBySubmodulo()[child.badgeKey] ?? 0;
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
    } else if (typeof window !== 'undefined' && window.innerWidth <= 1024) {
      // Z33 — en laptops/tablets (769–1024px) el sidebar arranca colapsado a
      // riel de iconos para dar más ancho al contenido; solo si el usuario no
      // fijó una preferencia (≤768px ya es drawer off-canvas, no aplica).
      this.collapsed.set(true);
    }
    this.notificaciones.refresh();
    this.realtimeNotificaciones.start();

    // AF38 — carga el orden del menú (best-effort; si falla, orden por defecto).
    this.moduloOrden.getOrdenMap().then((m) => this.ordenMap.set(m)).catch(() => {});

    // Notification center: load recent items + go live for this user.
    this.centro.cargar();
    const userId = this.userService.profile()?.id;
    if (userId) {
      this.centro.escuchar(userId);
      // W7 — auto-registra la versión web en el historial (idempotente, no bloquea).
      // Solo admins: registrar_version escribe en app_versiones (tabla admin-only).
      if (this.userService.hasRole('admin')) {
        void this.appVersiones.autoRegistrarVersionWeb();
      }
    }

    // Catches any count-affecting mutation that doesn't already call
    // refresh() directly (belt-and-suspenders alongside the explicit calls
    // in solicitudes-material/compra.service.ts and salidas.service.ts).
    this.router.events.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((event) => {
      if (event instanceof NavigationEnd) {
        this.notificaciones.refresh();
        // W12 — registrar actividad web (throttled en cliente y servidor).
        this.actividad.ping();
        // Close the bell dropdown + mobile drawer when navigating away.
        this.notifOpen.set(false);
        this.mobileNavOpen.set(false);
      }
    });
    // W12 — ping inicial al montar el shell (sesión iniciada).
    this.actividad.ping();
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
      // navigateByUrl respeta query-strings (deep-links AF6, ej. ?echada=<id>);
      // navigate([...]) los interpretaría como un segmento de ruta.
      this.router.navigateByUrl(n.ruta);
    }
  }

  marcarTodasLeidas() {
    this.centro.marcarTodasLeidas();
  }

  /** U9 — Fecha relativa en Spanish (delega en la utilidad compartida). */
  tiempoRelativo(iso: string): string {
    return formatFechaRelativa(iso);
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
    // AC2/AU8 — la persona "chofer" no ve items noChofer (Tecnología, "Conduces por
    // firmar"). Va ANTES que soloConPendiente: un chofer no firma/confirma entregas
    // (ni las suyas ni las de otro), así que aunque tenga un pendiente NO debe ver la
    // bandeja del despachante (evita el item que terminaba en 403).
    if (item.noChofer && this.userService.esChofer() && !this.userService.esTecnologia())
      return false;
    // AV2 — visible solo para roles específicos (p. ej. Mi rendimiento = Chofer + Jefe de flota).
    if (item.soloRoles) return item.soloRoles.some((r) => this.userService.hasRole(r));
    // AU1 — bandeja personal solo con pendientes (p. ej. Conduces por firmar).
    if (item.soloConPendiente) return this.pendingBadge(item) > 0;
    // AU6 — grupo paraguas (Ingeniería): visible si hay al menos un hijo accesible.
    if (item.showIfAnyChild) return (item.children ?? []).some((c) => this.canAccessChild(c));
    // AL1 — grupo "Sistema" (plataforma): solo es_tecnologia.
    if (item.soloTecnologia && !this.userService.esTecnologia()) return false;
    // AF32 — acceso extra por flota elevado (p. ej. Compras solo-Proveedores).
    if (item.flotaElevado && this.userService.esFlotaElevado()) return true;
    // AG12 — acceso extra por permiso granular de submódulo (p. ej. Compras solo-Proveedores).
    if (item.submodulos?.some((s) => this.userService.puedeVerSubmodulo(s))) return true;
    // AT (PROMPT-4) — acceso extra por módulo (p. ej. Flota visible para `incentivos`).
    if (item.extraModulo && this.userService.hasModulo(item.extraModulo)) return true;
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
