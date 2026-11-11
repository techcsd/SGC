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
import { ThemeService } from '../../services/theme.service';
import { ModuloOrdenService } from '../../services/modulo-orden.service';
import { FullscreenModeService } from '../../services/fullscreen-mode.service';
import { OnboardingWeb } from '../onboarding-web/onboarding-web';
import { Novedades } from '../novedades/novedades';
import { ConfirmDialog } from '../confirm-dialog/confirm-dialog';
import { LanguageOnboarding } from '../../ui/language-onboarding/language-onboarding';
import { PolicyGate } from '../../ui/policy-gate/policy-gate';
import { Celebracion } from '../../ui/celebracion/celebracion';
import { Momento } from '../../ui/momento/momento';
import { PracticaBanda } from '../../ui/practica-banda/practica-banda';
import { PracticaService } from '../../../app/core/practica/practica.service';
import { misionesParaRoles } from '../../../app/core/practica/practica.data';
import { Lightbox } from '../../ui/lightbox/lightbox';
import { LightboxService } from '../../ui/lightbox/lightbox.service';
import { TranslatePipe } from '../../i18n/translate.pipe';
import { I18nService } from '../../i18n/i18n.service';
import { EstadoPulseDirective } from '../../motion/estado-pulse.directive';
import { formatFechaRelativa } from '../../utils/fecha.util';
import { BuscadorMaestro } from '../buscador-maestro/buscador-maestro';
import { NavItem, NavSubItem, construirIndiceMenu, moduloActualDesdeRuta } from './menu-index.util';
import { esAtajoCtrlK, esAtajoBarra, esCampoDeTexto } from './atajo-buscador.util';
import { CompaFlotante } from '../compa-flotante/compa-flotante';
import { PreferenciasService } from '../../services/preferencias.service';
import { compaFlotanteVisible } from '../compa-flotante/compa-flotante-visibilidad.util';

export type { NavItem, NavSubItem };

@Component({
  selector: 'app-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, NgOptimizedImage, NgTemplateOutlet, OnboardingWeb, Novedades, ConfirmDialog, LanguageOnboarding, PolicyGate, Celebracion, Momento, PracticaBanda, Lightbox, TranslatePipe, EstadoPulseDirective, BuscadorMaestro, CompaFlotante],
  templateUrl: './shell.html',
  styleUrl: './shell.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    // DG — Ctrl+K (o Cmd+K en Mac) abre el buscador maestro desde cualquier
    // pantalla; `/` también, pero SOLO si el foco no está en un campo de texto
    // (si no, escribir "precio/u" en cualquier input abriría el buscador).
    '(document:keydown)': 'onKeydownGlobal($event)',
  },
})
export class Shell implements OnInit {
  private authService = inject(AuthService);
  private userService = inject(UserService);
  private router = inject(Router);
  lightbox = inject(LightboxService); // CM5 — visor global de fotos
  private notificaciones = inject(NotificacionesService);
  private realtimeNotificaciones = inject(RealtimeNotificacionesService);
  private centro = inject(NotificacionesCentroService);
  private appVersiones = inject(AppVersionesService);
  private datosPruebaView = inject(DatosPruebaViewService);
  private actividad = inject(ActividadService);
  protected theme = inject(ThemeService);
  private moduloOrden = inject(ModuloOrdenService);
  private destroyRef = inject(DestroyRef);
  private practica = inject(PracticaService); // F6 (DG5) — insignia de "Demo"
  private i18n = inject(I18nService);
  private preferencias = inject(PreferenciasService); // DG — Compa flotante (preferencia por persona)
  /** CQ2 — modo inmersivo (oculta sidebar + header), activado por pantallas como Dev notes. */
  protected fullscreenMode = inject(FullscreenModeService);

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

  // AY7 — sesión de usuario de prueba (banner + volver de impersonación).
  esUsuarioPrueba = computed(() => !!this.profile()?.es_prueba);
  hayImpersonacion = () => this.authService.hayImpersonacion();
  // AZ10 — impersonación de un usuario REAL (soporte): banner propio con el nombre + salida.
  impersonacionInfo = () => this.authService.impersonacionInfo();
  impersonandoReal = () => this.authService.hayImpersonacion() && !this.esUsuarioPrueba();
  async volverDeImpersonacion() {
    const eraReal = this.impersonandoReal();
    await this.authService.volverDeImpersonacion();
    window.location.assign(eraReal ? '/admin/usuarios' : '/admin/usuarios-test');
  }
  collapsed = signal(false);
  /** CN3 — ¿viewport de teléfono (≤768px)? Reactivo (matchMedia). */
  esMovil = signal(
    typeof window !== 'undefined' && window.matchMedia?.('(max-width: 768px)').matches === true,
  );
  /** CN3 — colapso EFECTIVO: en móvil el cajón es off-canvas con nombres, nunca riel de
   *  iconos, aunque haya una preferencia de colapso guardada del escritorio. */
  collapsedEfectivo = computed(() => this.collapsed() && !this.esMovil());
  /** Mobile off-canvas drawer (≤768px); independent of the desktop `collapsed`. */
  mobileNavOpen = signal(false);
  expandedSection = signal<string | null>('inventario');

  // ── Notification center (header bell) ──
  notifItems = this.centro.items;
  notifNoLeidas = this.centro.noLeidas;
  notifOpen = signal(false);

  // ── DG — Buscador maestro (Ctrl+K) ──
  buscadorAbierto = signal(false);

  // ── DG — Compa flotante (burbuja → ventana) ──
  /** Ruta activa (sin query string), actualizada en cada NavigationEnd (ver ngOnInit).
   *  Única fuente para "en <módulo>" Y para ocultar la flotante en /asistente — no
   *  se recalcula la ruta por otro camino. */
  rutaActual = signal(this.router.url.split('?')[0]);
  private enPantallaAsistente = computed(() => this.rutaActual() === '/asistente');
  /** "en <módulo>" de la barra de Compa flotante — reusa el MISMO índice de menú
   *  (permisos incluidos) que ya arma `menuIndice()` para el buscador maestro. */
  moduloActualLabel = computed(() => moduloActualDesdeRuta(this.rutaActual(), this.menuIndice()));
  /** Preferencia por persona (Configuración › Apariencia) + oculto en /asistente
   *  (redundante con la pantalla completa) + oculto durante una misión de práctica. */
  mostrarCompaFlotante = computed(() =>
    compaFlotanteVisible({
      prefActiva: this.preferencias.prefs()?.compa_flotante ?? true,
      enPantallaAsistente: this.enPantallaAsistente(),
      practicaActiva: this.practica.activa(),
    }),
  );

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
        { label: 'Retiros de material dañado', route: '/inventario/retiros', modulo: 'inventario' },
        { label: 'Movimientos', route: '/inventario/movimientos', submodulo: 'inventario.articulos' },
        { label: 'Conduces', route: '/inventario/conduces', submodulo: 'inventario.salidas' },
        { label: 'Conduces externos', route: '/inventario/conduces-externos', submodulo: 'inventario.salidas' },
        { label: 'Proveedores de transporte', route: '/inventario/proveedores-transporte', modulo: 'inventario', badgeKey: 'inventario.prov_transporte_por_ratificar' },
        { label: 'Lugares por registrar', route: '/inventario/lugares-por-registrar', modulo: 'inventario', badgeKey: 'inventario.lugares_por_registrar' },
        { label: 'Confirmaciones de entrega', route: '/inventario/confirmaciones', submodulo: 'inventario.salidas' },
        { label: 'Material no catalogado', route: '/inventario/material-no-catalogado', modulo: 'inventario', badgeKey: 'inventario.material_no_catalogado' },
        { label: 'Conduces por implementar', route: '/inventario/conduces-por-implementar', modulo: 'inventario', badgeKey: 'inventario.conduces_por_implementar' },
        { label: 'Conteos y ajustes', route: '/inventario/conteos', submodulo: 'inventario.conteos' },
        { label: 'Apertura de inventario', route: '/inventario/apertura', soloAdmin: true },
        { label: 'Reposición', route: '/inventario/reposicion', submodulo: 'inventario.articulos' },
        { label: 'Stock en Odoo', route: '/inventario/stock-odoo', modulo: 'inventario' },
        { label: 'Almacenes', route: '/inventario/bodegas', submodulo: 'inventario.articulos' },
        { label: 'Reportes', route: '/inventario/reportes', submodulo: 'inventario.salidas' },
      ],
    },
    {
      label: 'Compras',
      icon: 'purchases',
      modulo: 'compras',
      flotaElevado: true, // AF32 — jefe de flota entra SOLO a Proveedores
      submodulos: ['compras.proveedores', 'compras.solicitudes'], // AG12 — visible con permiso granular
      children: [
        { label: 'Proveedores', route: '/compras/proveedores', submodulo: 'compras.proveedores' },
        { label: 'Órdenes de Compra', route: '/compras/ordenes', submodulo: 'compras.ordenes', badgeKey: 'compras.ordenes' },
        // BH8 — "Solicitar Compra" donde vive quien la necesita (Raykler). Misma pantalla que en Ingeniería.
        { label: 'Solicitar Compra', route: '/compras/solicitar', submodulo: 'compras.solicitudes' },
        // CY24 Fase B (#24) — productos de una OC sin equivalente en Odoo.
        { label: 'Productos por dar de alta', route: '/compras/productos-por-dar-de-alta', modulo: 'compras', badgeKey: 'compras.productos_pendientes' },
        // DF-gastos — gastos directos del proyecto (sin requisición).
        { label: 'Gastos', route: '/compras/gastos', modulo: 'compras' },
        { label: 'Reportes', route: '/compras/reportes', modulo: 'compras' },
      ],
    },
    {
      label: 'RRHH',
      icon: 'hr',
      modulo: 'rrhh',
      children: [
        { label: 'Empleados', route: '/rrhh/empleados' },
        { label: 'Contratos y documentos', route: '/rrhh/contratos', submodulo: 'rrhh.contratos' },
        { label: 'Organigrama', route: '/rrhh/organigrama', submodulo: 'rrhh.organigrama' },
        { label: 'Reclutamiento', route: '/rrhh/onboarding', submodulo: 'rrhh.onboarding' },
        { label: 'Asistencia', route: '/rrhh/asistencia' },
        { label: 'Ausencias y vacaciones', route: '/rrhh/ausencias', badgeKey: 'rrhh.ausencias' },
        { label: 'Capacitación', route: '/rrhh/capacitacion', submodulo: 'rrhh.capacitacion' },
        { label: 'Evaluaciones', route: '/rrhh/evaluaciones', submodulo: 'rrhh.evaluaciones' },
        { label: 'Reportes', route: '/rrhh/reportes', submodulo: 'rrhh.reportes' },
        // DN-29 — Administración de la empresa (Gastos reusa /compras/gastos, sin duplicar).
        { label: 'Gastos y caja chica', route: '/compras/gastos', submodulo: 'rrhh.gastos' },
        { label: 'Trámites y cumplimiento', route: '/rrhh/tramites', submodulo: 'rrhh.tramites' },
        { label: 'Proveedores (administrativos)', route: '/rrhh/proveedores', submodulo: 'rrhh.proveedores' },
        { label: 'Activos y oficina', route: '/rrhh/activos', submodulo: 'rrhh.activos' },
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
        { label: 'Cargos y alias', route: '/proyectos/cargos', submodulo: 'proyectos.personal' },
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
        // CK15/CK16 — bandeja de trabajos de transporte + monitoreo de choferes (Misael).
        { label: 'Trabajos de transporte', route: '/transporte/trabajos', flotaElevado: true },
        { label: 'Mis choferes', route: '/transporte/mis-choferes', flotaElevado: true },
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
        // DE4 (Ronda DE, DE-12e) — transferencias "ofrecida" con antigüedad + Cancelar.
        { label: 'Transferencias pendientes', route: '/flota/transferencias', flotaElevado: true },
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
        { label: 'Firmas pendientes', route: '/legal/firmas-pendientes' },
        { label: 'Configuración', route: '/legal/configuracion' },
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
        { label: 'Apoyo de transporte', route: '/transporte/apoyo', badgeKey: 'solicitudes_movimiento', modulo: 'ingenieria' },
        // DB4 — pagos semanales con descargo firmado (ver también abogado/gerencia/dirección).
        { label: 'Pagos de la semana', route: '/ingenieria/pagos', submodulo: 'ingenieria.pagos' },
        // Bitácora (módulo `bitacora`)
        { label: 'Nueva bitácora', route: '/bitacora/nueva', modulo: 'bitacora' },
        { label: 'Mis bitácoras', route: '/bitacora/historial', modulo: 'bitacora' },
        { label: 'Órdenes de trabajo', route: '/bitacora/ordenes-trabajo', modulo: 'bitacora' },
        { label: 'Dashboard de bitácora', route: '/bitacora/dashboard', modulo: 'bitacora' },
        { label: 'Cobertura por obra', route: '/bitacora/cobertura', modulo: 'bitacora' },
        { label: 'Medidas de moldes', route: '/bitacora/moldes', modulo: 'bitacora' },
        { label: 'Cartillas de acero', route: '/bitacora/cartillas', modulo: 'bitacora' },
        { label: 'Mi proyecto', route: '/bitacora/mi-proyecto', modulo: 'bitacora' },
        { label: 'Requisición', route: '/bitacora/solicitudes-material', modulo: 'bitacora' },
        // BH8 — misma pantalla que en Compras (una sola, ruta canónica /compras/solicitar).
        { label: 'Solicitud de compra', route: '/compras/solicitar', submodulo: 'compras.solicitudes' },
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
      // CP8 — Reuniones: agenda, notas, acuerdos→tareas, actas. Gateado por el
      // módulo 'reuniones' (default: admin, gerencia/dirección, ingenieros,
      // logística, legal, RRHH — ver sql/2026-10-16-cp8-reuniones.sql §3).
      label: 'Reuniones',
      icon: 'reuniones',
      modulo: 'reuniones',
      route: '/reuniones',
    },
    {
      // AL1 — Tecnología REAL = activos/servicios de TI. Gateado por el módulo
      // `tecnologia` (+ admin), ya no visible para todo usuario no-chofer.
      label: 'Tecnología',
      icon: 'tecnologia',
      modulo: 'tecnologia',
      // CZ4 — "Tecnología de contenido" visible también con el permiso granular
      // suelto (Subadministrador), sin el módulo completo (que abriría plataforma).
      // DB2 — + wa_grupos, mismo motivo (ver nota en el hijo "Compa en WhatsApp").
      submodulos: ['tecnologia.cotizaciones', 'tecnologia.inventario', 'tecnologia.compras', 'tecnologia.wa_grupos'],
      children: [
        { label: 'Inventario tecnológico', route: '/tecnologia/inventario', submodulo: 'tecnologia.inventario' },
        // DH3/DH19 — movida al grupo «Sistema» (abajo), visible a TODO usuario
        // autenticado. Antes vivía aquí pero el GRUPO entero exige `modulo:
        // 'tecnologia'`, así que seguía oculta para quien no tuviera ese módulo.
        { label: 'Homologación', route: '/tecnologia/homologacion', modulo: 'tecnologia' },
        { label: 'Matriz puesto × herramienta', route: '/tecnologia/matriz', modulo: 'tecnologia' },
        { label: 'Compras tecnológicas', route: '/tecnologia/compras', submodulo: 'tecnologia.compras' },
        { label: 'Cotizaciones', route: '/tecnologia/cotizaciones', submodulo: 'tecnologia.cotizaciones' },
        // DB2 — movido aquí desde "Developer" (que es soloTecnologia, sin
        // escape por submódulo): así alguien con SOLO `tecnologia.wa_grupos`
        // (sin el módulo tecnologia completo) ve esta pantalla sin que el grupo
        // "Developer" entero (Odoo-sync, monitoreo, APIs, QA, Issues, Dev
        // notes) se le abra de paso.
        { label: 'Compa en WhatsApp', route: '/tecnologia/whatsapp', submodulo: 'tecnologia.wa_grupos', badgeKey: 'tecnologia.whatsapp' },
      ],
    },
    {
      // DG1 — "Developer" junta TODA la consola de plataforma/DevOps: lo que antes
      // era el grupo "Sistema" + "Monitoreo de infraestructura"/"APIs y consumo"
      // (antes en Tecnología) + "Pulso del sistema" (antes en Administración). Pedido
      // de Xaviel: "Todo Sistema + Monitoreo + APIs (Recomendado)". Solo es_tecnologia
      // (admin | tecnologia | gerencia | dirección); cada hijo conserva su propio gate
      // tal cual lo tenía en su grupo original — el grupo en sí no añade restricción.
      label: 'Developer',
      icon: 'developer',
      soloTecnologia: true,
      nuevoHasta: '2026-11-16',
      children: [
        // Versiones
        // DH3 — "Historial de versiones" se movió al grupo «Sistema» (abajo):
        // Xaviel no quería perder el acceso de todo usuario a ese submódulo al
        // crear Developer. "Versiones de la app" sigue solo-tecnología.
        { label: 'Versiones de la app', route: '/tecnologia/app-versiones', soloTecnologia: true },
        // Calidad
        { label: 'QA (pruebas)', route: '/tecnologia/qa', soloTecnologia: true },
        { label: 'Reportes de errores', route: '/tecnologia/reportes-errores', soloTecnologia: true },
        { label: 'Issues (Jira interno)', route: '/tecnologia/issues', soloTecnologia: true },
        // Dev notes
        { label: 'Dev notes', route: '/tecnologia/dev-notes', soloDesarrollador: true },
        // Compa / operación
        { label: 'Resumen de operaciones', route: '/tecnologia/resumen-operaciones', soloTecnologia: true },
        { label: 'Consultas de Compa', route: '/tecnologia/consultas-compa', soloTecnologia: true },
        { label: 'Conversaciones de Compa', route: '/admin/compa-conversaciones', soloAdmin: true },
        // DC7/DB2 — "Compa en WhatsApp" se movió al grupo "Tecnología" (arriba),
        // gateado por submódulo en vez de soloTecnologia — ver esa entrada.
        // F5 (ronda DF) — badge = propuestas del Escriba esperando tu OK.
        { label: 'Agentes', route: '/tecnologia/agentes', soloTecnologia: true, badgeKey: 'tecnologia.agentes' },
        // Infraestructura (AW9 — venían en Tecnología; F6c — Pulso venía en Administración)
        { label: 'Monitoreo de infraestructura', route: '/tecnologia/monitoreo', modulo: 'tecnologia' },
        { label: 'APIs y consumo', route: '/tecnologia/apis-consumo', modulo: 'tecnologia' },
        // DG1 — "Pulso del sistema" no tenía gate propio: heredaba el `modulo: 'admin'`
        // del grupo Administración. Se preserva como `soloAdmin` (mismo efecto práctico,
        // el idioma ya usado en este grupo para hojas admin-only como "Vault").
        { label: 'Pulso del sistema', route: '/admin/pulso-sistema', soloAdmin: true },
        { label: 'Outbox atascado', route: '/tecnologia/outbox-atascados', soloTecnologia: true },
        // CY16 (#16) — sincronización con Odoo (outbox distinto del de arriba).
        { label: 'Sincronización con Odoo', route: '/tecnologia/odoo-sync', soloTecnologia: true },
        { label: 'Envíos automáticos', route: '/tecnologia/envios-automaticos', soloTecnologia: true }, // CT10
        { label: 'Estadísticas', route: '/tecnologia/estadisticas', soloTecnologia: true },
        // Diseño
        { label: 'Sistema de diseño', route: '/tecnologia/design-system', soloTecnologia: true },
      ],
    },
    {
      // DH3/DH19 — grupo «Sistema»: visible a TODO usuario autenticado (sin
      // `modulo`/`soloTecnologia`), para no perder acceso a estos submódulos
      // informativos al crear el grupo «Developer» (gated, solo Tecnología).
      // Los permisos finos por rol (ver/ocultar cada ítem) se controlan desde
      // Administración › Roles vía `sistema.*` (F4, DH11).
      label: 'Sistema',
      icon: 'tecnologia',
      children: [
        { label: 'Historial de versiones', route: '/historial-versiones' },
        { label: 'Guía de herramientas', route: '/herramientas' },
      ],
    },
    {
      // AW4 — Tato, asistente de IA. Sin gate de módulo (hereda permisos del usuario).
      label: 'Compa (asistente)',
      icon: 'compa',
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
      // DM2 — módulo Claude (biblioteca de skills, Setup, auditoría). Sin gate
      // de módulo — el área de uso es para todo usuario autenticado (DM-03);
      // lo administrativo se gatea por submódulo dentro de la pantalla.
      label: 'Claude',
      icon: 'claude',
      route: '/claude',
    },
    {
      // F6 (DG5) — módulo "Demo" = práctica ampliada. Sin gate de módulo (como
      // Mensajes/Notas): visible para todo usuario autenticado. Insignia = misiones
      // del catálogo que el usuario todavía no completó (ver demoPendientes()).
      label: 'Demo',
      icon: 'demo',
      badgeKey: 'demo',
      children: [
        { label: 'Misiones', route: '/practica' },
        { label: 'Mi progreso', route: '/demo/progreso' },
        { label: 'Escenarios', route: '/demo/escenarios' },
      ],
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
      { label: 'Usuarios de prueba', route: '/admin/usuarios-test' },
      { label: 'Empresa', route: '/admin/empresa' },
      { label: 'Unidades', route: '/admin/unidades' },
      { label: 'Importar datos', route: '/admin/importar' },
      { label: 'Catálogos de bitácora', route: '/admin/bitacora-catalogos' },
      { label: 'Configuración del sistema', route: '/admin/parametros' },
      // Y11 — "Versiones de la app" e "Historial de versiones" movidas al módulo Tecnología.
      { label: 'Valores "Otro"', route: '/admin/otros-valores' },
      // BK1 — "Notificaciones" (switchboard viejo) retirado; absorbido en la Matriz.
      { label: 'Matriz de notificaciones', route: '/admin/matriz-notificaciones' },
      { label: 'Orden de módulos', route: '/admin/orden-modulos' },
      { label: 'Almacenes duplicados', route: '/admin/almacenes-duplicados' },
      { label: 'Usuarios duplicados', route: '/admin/usuarios-duplicados' },
      { label: 'Solicitudes de eliminación', route: '/admin/solicitudes-eliminacion' },
      { label: 'Auditoría', route: '/admin/auditoria' },
      // CZ3/DZ-08 — Vault: ROL estricto (no el módulo admin del contenedor),
      // oculto del menú a quien no sea admin aunque alguna vez tuviera el módulo.
      { label: 'Vault', route: '/admin/vault', soloAdmin: true },
      { label: 'Claude', route: '/admin/claude' },
      { label: 'Animaciones', route: '/admin/animaciones' },
      { label: 'Comentarios y Reportes', route: '/admin/reportes' },
      // F6c (ronda DF) — "Pulso del sistema" se movió a Developer (DG1), junto con
      // el resto de la consola de plataforma/DevOps.
    ],
  };

  isAdmin = computed(() => this.userService.hasRole('admin'));
  confirmLogoutOpen = signal(false);

  // F6 (DG5) — insignia del ítem "Demo": misiones del catálogo que el usuario nunca
  // ha intentado (best-effort; si falla, sin insignia — no bloquea el menú).
  demoPendientes = signal(0);

  /**
   * DG — índice único del menú para el buscador maestro. REUSA `canAccess`/
   * `canAccessChild` (las mismas funciones que gatean el sidebar) — el buscador
   * jamás puede mostrar una pantalla que el usuario no vería en el menú. Incluye
   * "Administración" solo cuando `isAdmin()` (igual que el sidebar, que la pinta
   * en un bloque aparte gateado por `isAdmin()`, no por `canAccess`).
   */
  menuIndice = computed(() => {
    const items = this.isAdmin() ? [...this.orderedNavItems(), this.adminNavItem] : this.orderedNavItems();
    return construirIndiceMenu(items, {
      canAccess: (item) => (item === this.adminNavItem ? true : this.canAccess(item)),
      canAccessChild: (child) => this.canAccessChild(child),
      t: (texto) => this.i18n.t(texto),
    });
  });

  /** DG1 — chip "Nuevo" junto al label de un grupo, visible hasta `nuevoHasta`
   *  inclusive (fin del día en hora local). */
  esNuevo(item: NavItem): boolean {
    if (!item.nuevoHasta) return false;
    const limite = new Date(`${item.nuevoHasta}T23:59:59`);
    return Date.now() <= limite.getTime();
  }

  pendingBadge(item: NavItem): number {
    const key = item.badgeKey ?? item.modulo;
    if (!key) return 0;
    // F6 (DG5) — "Demo": NO viene del backend de notificaciones (no es un módulo de
    // negocio); se calcula en el cliente contra el catálogo de misiones.
    if (key === 'demo') return this.demoPendientes();
    return this.notificaciones.pendingByModulo()[key] ?? 0;
  }

  canAccessChild(child: NavSubItem): boolean {
    // R14 — submódulos de flota solo para roles elevados (oculto al chofer).
    if (child.flotaElevado && !this.userService.esFlotaElevado()) return false;
    // Y11 — submódulos de plataforma solo para admin | rol tecnologia.
    if (child.soloTecnologia && !this.userService.esTecnologia()) return false;
    if (child.soloDesarrollador && !this.userService.esDesarrollador()) return false;
    // AS10 — herramientas admin (Apertura de inventario).
    if (child.soloAdmin && !this.userService.hasRole('admin')) return false;
    // AS7 — bandeja global de requisiciones (inventario o roles de proyecto).
    if (child.verTodasRequisiciones) return this.userService.puedeVerTodasRequisiciones();
    // AG12 / AY5 — submódulo con permiso granular. El menú DEBE leer la MISMA
    // matriz que el guard (submoduloGuard usa solo puedeVerSubmodulo). El atajo
    // de "flota elevado" se limita a submódulos de FLOTA; si se aplicaba a todos
    // (p. ej. obra.*), un rol como Logística (flota-elevado) veía submódulos de
    // Ingeniería que el guard después negaba con 403.
    if (child.submodulo) {
      if (child.submodulo.startsWith('flota.') && this.userService.esFlotaElevado()) return true;
      return this.userService.puedeVerSubmodulo(child.submodulo);
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
    // AZ10 — límite duro de 1 h de la sesión impersonada: si ya venció, salir; si no, vigilar.
    if (this.authService.hayImpersonacion()) {
      if (this.authService.impersonacionExpirada()) {
        void this.volverDeImpersonacion();
      } else {
        setInterval(() => {
          if (this.authService.impersonacionExpirada()) void this.volverDeImpersonacion();
        }, 60_000);
      }
    }
    const saved = localStorage.getItem('sgc-sidebar-collapsed');
    if (saved !== null) {
      this.collapsed.set(saved === 'true');
    } else if (typeof window !== 'undefined' && window.innerWidth > 768 && window.innerWidth <= 1024) {
      // Z33 — en laptops/tablets (769–1024px) el sidebar arranca colapsado a
      // riel de iconos para dar más ancho al contenido; solo si el usuario no
      // fijó una preferencia (≤768px ya es drawer off-canvas, no aplica).
      this.collapsed.set(true);
    }
    // CN3 — mantener `esMovil` reactivo al rotar/redimensionar el teléfono.
    if (typeof window !== 'undefined' && window.matchMedia) {
      const mq = window.matchMedia('(max-width: 768px)');
      const onMq = (e: MediaQueryListEvent) => this.esMovil.set(e.matches);
      mq.addEventListener('change', onMq);
      this.destroyRef.onDestroy(() => mq.removeEventListener('change', onMq));
    }

    // DL-33 — al volver a la pestaña con el perfil viejo (p. ej. un admin te
    // cambió el rol mientras tenías la web abierta), recarga roles/módulos sin
    // esperar los 5 min del guard ni forzar un logout.
    if (typeof document !== 'undefined') {
      const onFoco = () => void this.userService.refreshIfStale();
      const onVisibilidad = () => {
        if (document.visibilityState === 'visible') onFoco();
      };
      document.addEventListener('visibilitychange', onVisibilidad);
      window.addEventListener('focus', onFoco);
      this.destroyRef.onDestroy(() => {
        document.removeEventListener('visibilitychange', onVisibilidad);
        window.removeEventListener('focus', onFoco);
      });
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
      // F6 (DG5) — insignia de "Demo": misiones del catálogo sin ningún intento todavía.
      this.practica.resultadosPersona(userId)
        .then((filas) => {
          const total = misionesParaRoles(this.userService.roles());
          const intentadas = new Set(filas.map((f) => f.mision_id));
          this.demoPendientes.set(total.filter((m) => !intentadas.has(m.id)).length);
        })
        .catch(() => {});
    }

    // Catches any count-affecting mutation that doesn't already call
    // refresh() directly (belt-and-suspenders alongside the explicit calls
    // in solicitudes-material/compra.service.ts and salidas.service.ts).
    this.router.events.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((event) => {
      if (event instanceof NavigationEnd) {
        // DG — Compa flotante: "en <módulo>" + ocultar en /asistente leen de aquí.
        this.rutaActual.set(event.urlAfterRedirects.split('?')[0]);
        this.notificaciones.refresh();
        // W12 — registrar actividad web (throttled en cliente y servidor).
        this.actividad.ping();
        // Close the bell dropdown + mobile drawer when navigating away.
        this.notifOpen.set(false);
        this.mobileNavOpen.set(false);
        // CQ2 — red de seguridad: si se navega fuera de la pantalla que activó el
        // modo inmersivo sin que esta alcanzara a desactivarlo (p. ej. un enlace
        // directo), el shell no debe quedar con el chrome oculto para siempre.
        if (this.fullscreenMode.activo() && !event.urlAfterRedirects.startsWith('/tecnologia/dev-notes')) {
          this.fullscreenMode.desactivar();
        }
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

  /** DG — Ctrl/Cmd+K siempre abre el buscador; `/` también, pero solo si el foco no
   *  está en un campo de texto/textarea/select/contenteditable (si no, cualquier
   *  pantalla con un input de búsqueda quedaría imposible de usar con "/"). */
  onKeydownGlobal(e: KeyboardEvent) {
    if (esAtajoCtrlK(e)) {
      e.preventDefault();
      this.abrirBuscador();
      return;
    }
    const focoEnCampo = esCampoDeTexto(e.target as HTMLElement | null);
    if (esAtajoBarra(e, { buscadorYaAbierto: this.buscadorAbierto(), focoEnCampoDeTexto: focoEnCampo })) {
      e.preventDefault();
      this.abrirBuscador();
    }
  }

  abrirBuscador() {
    this.buscadorAbierto.set(true);
  }

  cerrarBuscador() {
    this.buscadorAbierto.set(false);
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
    if (item.soloDesarrollador && !this.userService.esDesarrollador()) return false;
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
