import { Component, ChangeDetectionStrategy, inject, signal, computed, OnInit } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { SolicitudesMaterialService, RequisicionAvanceItem, ConduceSuelto } from '../../../../shared/services/solicitudes-material.service';
import { BodegasService } from '../../../../shared/services/bodegas.service';
import { ArticulosService } from '../../../../shared/services/articulos.service';
import { CategoriasService } from '../../../../shared/services/categorias.service';
import { StockService } from '../../../../shared/services/stock.service';
import { UserService } from '../../../core/services/user.service';
import { ToastService } from '../../../../shared/services/toast.service';
import { SolicitudMaterial, requisicionCodigo, solicitanteRolLabel } from '../../../../shared/models/solicitud.model';
import { Bodega } from '../../../../shared/models/bodega.model';
import { Articulo } from '../../../../shared/models/articulo.model';
import { Categoria } from '../../../../shared/models/categoria.model';
import { FormDrawer } from '../../../../shared/components/form-drawer/form-drawer';
import { Skeleton } from '../../../../shared/components/skeleton/skeleton';
import { RequisicionItemsMapper, ReqItemMap } from '../../../../shared/ui/requisicion-items-mapper/requisicion-items-mapper';
import { FilterSelect } from '../../../../shared/ui/filter-select/filter-select';
import { UserPicker, UserPickerSelection } from '../../../../shared/ui/user-picker/user-picker';
import { formatFechaDisplay, formatFechaHoraDisplay, daysUntil, todayIso } from '../../../../shared/utils/fecha.util';
import { exportarExcel } from '../../../../shared/utils/exportar-excel.util';
import { humanizeError } from '../../../../shared/utils/friendly-error.util';

const ESTADO_BADGE: Record<string, string> = {
  pendiente: 'warning',
  aprobada: 'info',
  entregada: 'success',
  cerrada: 'success',
  rechazada: 'danger',
  // BA / Transporte v3 — despachos
  por_despachar: 'warning',
  parcial: 'info',
  completada: 'success',
  cancelada: 'danger',
};

// A2: "aprobada" = despachada en parte y con compra pendiente por el faltante.
const ESTADO_LABEL: Record<string, string> = {
  pendiente: 'Pendiente',
  aprobada: 'Aprobada (en compra)',
  entregada: 'Entregada',
  cerrada: 'Cerrada',
  rechazada: 'Rechazada',
  // BA / Transporte v3 — despachos
  por_despachar: 'Por despachar',
  parcial: 'Despacho parcial',
  completada: 'Completada',
  cancelada: 'Cancelada',
};

const hoy = () => new Date().toISOString().slice(0, 10);

/**
 * AS7 — Bandeja GLOBAL de requisiciones (todas las obras). Reusa el mismo
 * `getAll()` cuya RLS decide qué ve cada quien: los privilegiados
 * (`puede_ver_todas_requisiciones`) ven todo; el ingeniero solo lo suyo (aunque
 * ese perfil usa "Mis requisiciones"). Gestión (Aprobar/Rechazar) via los RPCs
 * existentes — el servidor valida quién puede hacer qué.
 */
@Component({
  selector: 'app-inventario-requisiciones',
  imports: [RouterLink, FormDrawer, Skeleton, RequisicionItemsMapper, FilterSelect, UserPicker],
  templateUrl: './requisiciones.html',
  styleUrl: './requisiciones.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Requisiciones implements OnInit {
  private service = inject(SolicitudesMaterialService);
  private bodegasService = inject(BodegasService);
  private articulosService = inject(ArticulosService);
  private categoriasService = inject(CategoriasService);
  private stockService = inject(StockService);
  private userService = inject(UserService);
  private toast = inject(ToastService);
  private route = inject(ActivatedRoute);

  readonly formatFecha = formatFechaDisplay;
  // AT22 — created_at es timestamptz: fecha + hora exacta en lista y detalle.
  readonly formatTimestamp = formatFechaHoraDisplay;
  estadoBadge = (e: string) => ESTADO_BADGE[e] ?? 'neutral';
  estadoLabel = (e: string) => ESTADO_LABEL[e] ?? e;

  requisiciones = signal<SolicitudMaterial[]>([]);
  bodegas = signal<Bodega[]>([]);
  loading = signal(true);
  error = signal('');

  // AT7 — catálogo para el mapeador de renglones (preselección + fuzzy + stock).
  articulos = signal<Articulo[]>([]);
  categorias = signal<Categoria[]>([]);
  stockMap = signal<Record<string, number>>({});
  /** Renglones ya mapeados al catálogo (emitidos por app-requisicion-items-mapper). */
  mappedItems = signal<ReqItemMap[]>([]);

  // ── Filtros ──────────────────────────────────────────────
  fObra = signal('');
  fSolicitante = signal('');
  fEstado = signal('');
  fUrgencia = signal('');
  // BP6 — opciones del filtro de estado (chip + popover, filter-select).
  readonly estadoOpt = [
    { value: 'pendiente', label: 'Pendiente' },
    { value: 'aprobada', label: 'Aprobada (en compra)' },
    { value: 'entregada', label: 'Entregada' },
    { value: 'cerrada', label: 'Cerrada' },
    { value: 'rechazada', label: 'Rechazada' },
    { value: 'cancelada', label: 'Cancelada' },
  ];
  fDesde = signal('');
  fHasta = signal('');
  fArticulo = signal('');
  search = signal('');
  // BH1 — una prueba cancelada no debe parecer trabajo pendiente: ocultas por defecto.
  ocultarCanceladas = signal(true);
  // BO8 — orden de la bandeja: por defecto la más reciente; opción "por fecha de
  // necesidad" (la más próxima/vencida primero) para que Raykler priorice por obra.
  orden = signal<'reciente' | 'necesidad'>('reciente');
  // BO8 — solo requisiciones con fecha de necesidad fijada.
  soloConNecesidad = signal(false);
  /** BO8 — días hasta la fecha de necesidad (chip "faltan N / vencida"). */
  diasNecesidad = (f: string | null | undefined) => (f ? daysUntil(f) : null);

  // ── Detalle / gestión ────────────────────────────────────
  selected = signal<SolicitudMaterial | null>(null);
  drawerOpen = signal(false);
  mode = signal<'ver' | 'aprobar' | 'rechazar'>('ver');
  bodegaId = signal<string>('');
  fecha = signal<string>(hoy());
  responsable = signal<string>('');
  // BR2 — usuario responsable enlazado (buscar por usuario, no texto libre).
  responsableId = signal<string | null>(null);
  observaciones = signal<string>('');
  rechazoNota = signal<string>('');
  saving = signal(false);
  actionError = signal('');

  // ── BA / Transporte v3 — despachos (avance + cierre/cancelación) ──────────
  avanceItems = signal<RequisicionAvanceItem[]>([]);
  cargandoAvance = signal(false);
  mostrarCancelar = signal(false);
  cancelarMotivo = signal('');
  // Vincular conduce suelto (rectificación)
  mostrarVincular = signal(false);
  conducesSueltos = signal<ConduceSuelto[]>([]);
  cargandoSueltos = signal(false);
  // Mirror (parcial) de sgc.puede_gestionar_requisicion: roles del set aprobado.
  // El autor/responsable también pueden (lo valida el servidor); el ingeniero de
  // campo común no ve estos botones.
  puedeGestionarReq = computed(() =>
    ['admin', 'logistica', 'coord_compras', 'jefe_ingenieros', 'tecnologia'].some((r) => this.userService.hasRole(r)),
  );

  /** Quién puede gestionar (mirror del gate del servidor). El ingeniero no llega aquí. */
  puedeGestionar = computed(() => this.userService.puedeVerTodasRequisiciones());

  // ── BH1 — la acción no se pinta si el guard la va a negar (4ª regla del checklist) ──
  /** Id del usuario en sesión (para saber si mira su propia requisición). */
  private miId = computed(() => this.userService.profile()?.id ?? null);
  /** El admin puentea el gate de autor. */
  esAdmin = computed(() => this.userService.hasRole('admin'));
  /** ¿El que mira es quien creó la requisición? */
  esAutor(s: SolicitudMaterial): boolean {
    const id = this.miId();
    return !!id && s.solicitante_id === id;
  }
  /**
   * "Gestionar" (aprobar / rechazar) = un tercero con módulo/rol, NUNCA el autor.
   * Espejo exacto de sgc.rechazar_solicitud_material, que lanza
   * "No puedes rechazar tu propia solicitud" si solicitante = uid y no es admin.
   */
  puedeRechazar(s: SolicitudMaterial): boolean {
    return this.puedeGestionar() && s.estado === 'pendiente' && (!this.esAutor(s) || this.esAdmin());
  }
  /** Estados en los que una requisición todavía se puede cancelar (no cerrada/rechazada/entregada). */
  private readonly ESTADOS_CANCELABLES = ['pendiente', 'aprobada', 'por_despachar', 'parcial'];
  /**
   * "Disponer de lo mío" (cancelar) = el autor, un admin, o un gestor. Espejo de
   * sgc.puede_disponer_de_mi_requisicion (autor o admin) + regla BA6 de que un gestor
   * también puede cancelar.
   */
  puedeCancelar(s: SolicitudMaterial): boolean {
    return (
      (this.esAutor(s) || this.esAdmin() || this.puedeGestionarReq()) &&
      this.ESTADOS_CANCELABLES.includes(s.estado)
    );
  }

  obrasDisponibles = computed(() => {
    const map = new Map<string, string>();
    for (const r of this.requisiciones()) {
      if (r.proyecto_id) map.set(r.proyecto_id, r.proyecto?.nombre ?? '—');
    }
    return [...map.entries()]
      .map(([id, nombre]) => ({ id, nombre }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre));
  });

  solicitantesDisponibles = computed(() => {
    const map = new Map<string, string>();
    for (const r of this.requisiciones()) {
      if (r.solicitante_id) map.set(r.solicitante_id, this.solicitanteNombre(r));
    }
    return [...map.entries()]
      .map(([id, nombre]) => ({ id, nombre }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre));
  });

  /**
   * BS1 (regla 16) — el select de "Almacén de despacho" ofrece TODOS los almacenes
   * activos que el rol puede leer, no solo el de la obra: la conveniencia es el
   * PRESELECCIONADO (Central), nunca el filtro. Orden: Central (`es_central`) →
   * el de la obra de la requisición → resto por nombre.
   */
  bodegasDespacho = computed(() => {
    const pid = this.selected()?.proyecto_id ?? null;
    const rank = (b: Bodega): number => {
      if (b.es_central) return 0;
      if (pid && b.proyecto_id === pid) return 1;
      return 2;
    };
    return [...this.bodegas()].sort(
      (a, b) => rank(a) - rank(b) || a.nombre.localeCompare(b.nombre),
    );
  });

  /** BS1 — stock por almacén cacheado (renglones cubiertos n/N en cada opción). */
  private stockCache = signal<Record<string, Record<string, number>>>({});

  /** Renglones del pedido abierto (fuente de la cobertura, estable al abrir). */
  private renglonesPedido = computed(() => this.selected()?.items ?? []);

  /** BS1 — "renglones cubiertos n/N" de un almacén: n = renglones con artículo del
   *  catálogo cuyo stock en ese almacén alcanza la cantidad; N = total de renglones. */
  cobertura(bodegaId: string): { n: number; N: number } | null {
    const stock = this.stockCache()[bodegaId];
    const renglones = this.renglonesPedido();
    const N = renglones.length;
    if (!stock || N === 0) return null;
    const n = renglones.filter(
      (i) => i.articulo_id && (stock[i.articulo_id] ?? 0) >= (i.cantidad ?? 0),
    ).length;
    return { n, N };
  }

  coberturaLabel(bodegaId: string): string {
    const c = this.cobertura(bodegaId);
    return c ? ` — cubre ${c.n}/${c.N}` : '';
  }

  /** Carga (y cachea) el stock de un almacén para calcular su cobertura. */
  private async cargarStockBodega(bodegaId: string): Promise<void> {
    if (!bodegaId || this.stockCache()[bodegaId]) return;
    try {
      const map = await this.stockService.getMapByBodega(bodegaId);
      this.stockCache.update((c) => ({ ...c, [bodegaId]: map }));
    } catch {
      /* best-effort: sin cobertura para ese almacén, no rompe el picker */
    }
  }

  /** BS1 — precarga perezosa de la cobertura de todos los almacenes al abrir el select. */
  precargarCoberturas(): void {
    for (const b of this.bodegasDespacho()) void this.cargarStockBodega(b.id);
  }

  pendientesCount = computed(
    () => this.requisiciones().filter((r) => r.estado === 'pendiente').length,
  );

  hasActiveFilters = computed(
    () =>
      !!this.fObra() ||
      !!this.fSolicitante() ||
      !!this.fEstado() ||
      !!this.fUrgencia() ||
      !!this.fDesde() ||
      !!this.fHasta() ||
      !!this.fArticulo() ||
      !!this.search() ||
      this.soloConNecesidad(),
  );

  filtered = computed(() => {
    const obra = this.fObra();
    const sol = this.fSolicitante();
    const est = this.fEstado();
    const urg = this.fUrgencia();
    const desde = this.fDesde();
    const hasta = this.fHasta();
    const art = this.fArticulo().trim().toLowerCase();
    const q = this.search().trim().toLowerCase();

    const soloNec = this.soloConNecesidad();

    return this.requisiciones().filter((r) => {
      // BH1 — canceladas ocultas por defecto, salvo que se filtren explícitamente.
      if (this.ocultarCanceladas() && !est && r.estado === 'cancelada') return false;
      if (soloNec && !r.fecha_necesidad) return false; // BO8
      if (obra && r.proyecto_id !== obra) return false;
      if (sol && r.solicitante_id !== sol) return false;
      if (est && r.estado !== est) return false;
      if (urg && r.urgencia !== urg) return false;
      // created_at es ISO; comparo por prefijo YYYY-MM-DD para no romper zonas horarias.
      const fecha = (r.created_at ?? '').slice(0, 10);
      if (desde && fecha < desde) return false;
      if (hasta && fecha > hasta) return false;
      if (art && !(r.items ?? []).some((i) => (i.descripcion ?? '').toLowerCase().includes(art)))
        return false;
      if (q) {
        const hay = [
          r.proyecto?.nombre,
          r.solicitante?.nombre,
          r.notas,
          ...(r.items ?? []).map((i) => i.descripcion),
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  });

  // BO8 (§E-7) — vista de la bandeja: lista, por semana, o rejilla mensual (BO8 mes).
  vista = signal<'lista' | 'semana' | 'mes'>('lista');

  // BO8 (mes) — mes de referencia (YYYY-MM). Navegación ‹ mes ›.
  readonly DIAS_ABREV = ['Do', 'Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sa'];
  mesRef = signal<string>(todayIso().slice(0, 7));
  private pad2(n: number): string { return String(n).padStart(2, '0'); }

  mesLabel = computed(() => {
    const [y, m] = this.mesRef().split('-').map(Number);
    const meses = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
    return `${meses[m - 1]} ${y}`;
  });

  cambiarMes(delta: number) {
    const [y, m] = this.mesRef().split('-').map(Number);
    const idx = (m - 1) + delta;
    const ny = y + Math.floor(idx / 12);
    const nm = ((idx % 12) + 12) % 12;
    this.mesRef.set(`${ny}-${this.pad2(nm + 1)}`);
  }

  /** BO8 (mes) — rejilla de 6×7 celdas del mes; cada día lista sus requisiciones por
   *  fecha_necesidad. Sin `new Date(dateOnly)` para las fechas de datos (se comparan por
   *  string YYYY-MM-DD); el grid se arma con el constructor numérico de Date (sin TZ). */
  calendario = computed(() => {
    const [y, m] = this.mesRef().split('-').map(Number);
    const startDow = new Date(y, m - 1, 1).getDay();
    const daysInMonth = new Date(y, m, 0).getDate();
    const hoy = todayIso();
    const byDay = new Map<string, SolicitudMaterial[]>();
    for (const r of this.filtered()) {
      if (!r.fecha_necesidad) continue;
      const key = r.fecha_necesidad.slice(0, 10);
      (byDay.get(key) ?? byDay.set(key, []).get(key)!).push(r);
    }
    const cells: { key: string; dayNum: number | null; inMonth: boolean; hoy: boolean; items: SolicitudMaterial[] }[] = [];
    for (let i = 0; i < 42; i++) {
      const dayNum = i - startDow + 1;
      const inMonth = dayNum >= 1 && dayNum <= daysInMonth;
      const key = inMonth ? `${y}-${this.pad2(m)}-${this.pad2(dayNum)}` : '';
      cells.push({ key, dayNum: inMonth ? dayNum : null, inMonth, hoy: key === hoy, items: inMonth ? (byDay.get(key) ?? []) : [] });
    }
    return cells;
  });

  /** BO8 (mes) — requisiciones sin fecha de necesidad (cajón debajo de la rejilla). */
  sinFechaMes = computed(() => this.filtered().filter((r) => !r.fecha_necesidad));

  /**
   * BO8 (§E-7) — agrupa lo filtrado en cubos por proximidad de la fecha de necesidad:
   * Vencidas / Esta semana / Próxima semana / Más adelante / Sin fecha. Usa daysUntil
   * (parte el string, sin `new Date(dateOnly)`), no matemática de calendario.
   */
  grupos = computed(() => {
    const buckets: { key: string; titulo: string; orden: number; items: SolicitudMaterial[] }[] = [
      { key: 'vencidas', titulo: 'Vencidas', orden: 0, items: [] },
      { key: 'semana', titulo: 'Esta semana', orden: 1, items: [] },
      { key: 'proxima', titulo: 'Próxima semana', orden: 2, items: [] },
      { key: 'adelante', titulo: 'Más adelante', orden: 3, items: [] },
      { key: 'sinfecha', titulo: 'Sin fecha de necesidad', orden: 4, items: [] },
    ];
    const by = new Map(buckets.map((b) => [b.key, b]));
    for (const r of this.filtered()) {
      const fn = r.fecha_necesidad;
      let key: string;
      if (!fn) key = 'sinfecha';
      else {
        const d = daysUntil(fn);
        key = d < 0 ? 'vencidas' : d <= 6 ? 'semana' : d <= 13 ? 'proxima' : 'adelante';
      }
      by.get(key)!.items.push(r);
    }
    // Dentro de cada cubo, la más próxima/vencida primero; las sin fecha por reciente.
    for (const b of buckets) {
      if (b.key === 'sinfecha') continue;
      b.items.sort((a, c) => ((a.fecha_necesidad ?? '') < (c.fecha_necesidad ?? '') ? -1 : 1));
    }
    return buckets.filter((b) => b.items.length);
  });

  /** BO8 — orden aplicado sobre lo filtrado. 'reciente' preserva created_at desc
   *  (orden del getAll); 'necesidad' pone la fecha más próxima/vencida primero y las
   *  sin fecha al final. No muta el array de la señal (copia con [...]). */
  ordenadas = computed(() => {
    const rows = this.filtered();
    if (this.orden() !== 'necesidad') return rows;
    return [...rows].sort((a, b) => {
      const fa = a.fecha_necesidad ?? null;
      const fb = b.fecha_necesidad ?? null;
      if (fa && fb) return fa < fb ? -1 : fa > fb ? 1 : 0;
      if (fa) return -1;
      if (fb) return 1;
      return 0;
    });
  });

  async ngOnInit() {
    const obra = this.route.snapshot.queryParamMap.get('obra');
    if (obra) this.fObra.set(obra);
    await this.loadAll();
    // AS6 — deep-link desde el email (?req=<id>): abre directamente esa requisición.
    const reqId = this.route.snapshot.queryParamMap.get('req');
    if (reqId) {
      const it = this.requisiciones().find((r) => r.id === reqId);
      if (it) this.abrir(it);
    }
  }

  private async loadAll() {
    this.loading.set(true);
    this.error.set('');
    try {
      const [reqs, bodegas, articulos, categorias, dir] = await Promise.all([
        this.service.getAll(),
        this.bodegasService.getAll(),
        this.articulosService.getAll(),
        this.categoriasService.getAll(),
        this.service.usuariosDirectorio().catch(() => new Map<string, { nombre: string; roles: string[] }>()),
      ]);
      // BF6 — resuelve el solicitante por directorio (SECURITY DEFINER) para que
      // nunca salga "Solicitante: —" cuando la RLS de usuarios oculta la fila.
      for (const r of reqs) {
        const u = r.solicitante_id ? dir.get(r.solicitante_id) : undefined;
        if (u) r.solicitante_nombre_dir = u.nombre;
      }
      this.requisiciones.set(reqs);
      this.bodegas.set(bodegas.filter((b) => b.activo !== false));
      this.articulos.set(articulos.filter((a) => a.activo));
      this.categorias.set(categorias);
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'Error al cargar las requisiciones.');
    } finally {
      this.loading.set(false);
    }
  }

  /** AT7 — carga el stock del almacén elegido (para decidir despacho vs compra). */
  private async loadStock(bodegaId: string): Promise<void> {
    if (!bodegaId) { this.stockMap.set({}); return; }
    try {
      const map = await this.stockService.getMapByBodega(bodegaId);
      this.stockMap.set(map);
      this.stockCache.update((c) => ({ ...c, [bodegaId]: map })); // BS1 — reutiliza para la cobertura
    } catch {
      this.stockMap.set({});
    }
  }

  /** Cambia el almacén de despacho y refresca el stock por renglón. */
  onBodegaAprob(id: string) {
    this.bodegaId.set(id);
    void this.loadStock(id);
  }

  itemsCount(r: SolicitudMaterial): number {
    return (r.items ?? []).length;
  }

  // BC4 — código citable (REQ-XXXXXX) y rol del solicitante para el contexto.
  codigo(r: SolicitudMaterial): string {
    return requisicionCodigo(r);
  }
  rolSolicitante(r: SolicitudMaterial): string {
    return solicitanteRolLabel(r);
  }
  /** BF6 — nombre del solicitante robusto: embed → directorio → '—'. */
  solicitanteNombre(r: SolicitudMaterial): string {
    return r.solicitante?.nombre ?? r.solicitante_nombre_dir ?? '—';
  }

  // BR2 — el picker de responsable emite {usuario_id, nombre}.
  onResponsablePicked(sel: UserPickerSelection) {
    this.responsableId.set(sel.usuario_id);
    this.responsable.set(sel.nombre);
  }

  // ── Detalle ───────────────────────────────────────────────
  abrir(r: SolicitudMaterial) {
    this.selected.set(r);
    this.mode.set('ver');
    this.actionError.set('');
    this.rechazoNota.set('');
    this.responsable.set('');
    this.responsableId.set(null);
    this.observaciones.set('');
    this.fecha.set(hoy());
    // BS1 (regla 16) — preselección por conveniencia (Central si cubre ≥1 renglón;
    // si no, la de la obra), pero el select ofrece TODOS los almacenes.
    this.stockMap.set({});
    void this.preseleccionarBodega(r);
    this.mostrarCancelar.set(false);
    this.cancelarMotivo.set('');
    this.mostrarVincular.set(false);
    this.drawerOpen.set(true);
    void this.cargarAvance(r.id);
  }

  cerrar() {
    this.drawerOpen.set(false);
  }

  /**
   * BS1 — preselecciona el almacén de despacho por conveniencia sin ESCONDER el
   * resto (regla 16): Central si cubre ≥1 renglón del pedido; si no, la de la obra;
   * si no hay ninguna, la primera de la lista. El usuario puede cambiarlo.
   */
  private async preseleccionarBodega(r: SolicitudMaterial): Promise<void> {
    const pid = r.proyecto_id ?? null;
    const lista = this.bodegasDespacho();
    const central = lista.find((b) => b.es_central) ?? null;
    const obra = pid ? lista.find((b) => b.proyecto_id === pid) ?? null : null;
    // Provisional inmediato para que el select no quede vacío mientras carga el stock.
    const provisional = central ?? obra ?? lista[0] ?? null;
    if (provisional) this.onBodegaAprob(provisional.id);
    // Refina con la cobertura real: Central si cubre ≥1; si no, la de la obra.
    await Promise.all(
      [central?.id, obra?.id]
        .filter((id): id is string => !!id)
        .map((id) => this.cargarStockBodega(id)),
    );
    if (central && obra) {
      const cov = this.cobertura(central.id);
      if (cov && cov.n === 0) this.onBodegaAprob(obra.id);
    }
  }

  // ── BA / Transporte v3 — despachos ─────────────────────────────────────────
  async cargarAvance(id: string) {
    this.avanceItems.set([]);
    this.cargandoAvance.set(true);
    try {
      this.avanceItems.set(await this.service.avance(id));
    } catch {
      /* avance vacío no es error */
    } finally {
      this.cargandoAvance.set(false);
    }
  }

  async cerrarRequisicion() {
    const s = this.selected();
    if (!s || this.saving()) return;
    this.saving.set(true);
    this.actionError.set('');
    try {
      await this.service.cerrar(s.id);
      this.toast.success('Requisición cerrada');
      this.drawerOpen.set(false);
      await this.loadAll();
    } catch (e) {
      this.actionError.set(e instanceof Error ? e.message : 'No se pudo cerrar.');
    } finally {
      this.saving.set(false);
    }
  }

  /** BJ4 — quitar (cancelar) una línea de la requisición, con motivo, dejando el
   *  resto despachable. Recarga el avance para reflejar el nuevo pendiente/estado. */
  async quitarLinea(item: RequisicionAvanceItem) {
    const s = this.selected();
    if (!s || this.saving()) return;
    const motivo = (prompt(`Motivo para quitar "${item.descripcion}" de la requisición:`) ?? '').trim();
    if (!motivo) return;
    this.saving.set(true);
    this.actionError.set('');
    try {
      await this.service.cancelarItem(item.item_id, motivo);
      this.toast.success('Línea quitada', 'El resto de la requisición sigue despachable.');
      await this.cargarAvance(s.id);
      await this.loadAll();
    } catch (e) {
      this.actionError.set(e instanceof Error ? e.message : 'No se pudo quitar la línea.');
    } finally {
      this.saving.set(false);
    }
  }

  async confirmarCancelar() {
    const s = this.selected();
    if (!s || this.saving()) return;
    const motivo = this.cancelarMotivo().trim();
    if (!motivo) { this.actionError.set('El motivo de cancelación es obligatorio.'); return; }
    this.saving.set(true);
    this.actionError.set('');
    try {
      await this.service.cancelar(s.id, motivo);
      this.toast.success('Requisición cancelada');
      this.drawerOpen.set(false);
      await this.loadAll();
    } catch (e) {
      this.actionError.set(e instanceof Error ? e.message : 'No se pudo cancelar.');
    } finally {
      this.saving.set(false);
    }
  }

  async abrirVincular() {
    const s = this.selected();
    if (!s) return;
    this.mostrarVincular.set(true);
    this.cargandoSueltos.set(true);
    this.conducesSueltos.set([]);
    try {
      // Candidatos de la misma obra primero; si no hay, cualquiera sin vincular.
      let sueltos = await this.service.conducesSinVincular(s.proyecto_id);
      if (!sueltos.length) sueltos = await this.service.conducesSinVincular(null);
      this.conducesSueltos.set(sueltos);
    } catch (e) {
      this.actionError.set(e instanceof Error ? e.message : 'No se pudieron cargar los conduces.');
    } finally {
      this.cargandoSueltos.set(false);
    }
  }

  async vincular(salidaId: string) {
    const s = this.selected();
    if (!s || this.saving()) return;
    this.saving.set(true);
    this.actionError.set('');
    try {
      await this.service.vincularConduce(s.id, salidaId);
      this.toast.success('Conduce vinculado', 'El avance ya cuenta este despacho.');
      this.mostrarVincular.set(false);
      await this.cargarAvance(s.id);
      await this.loadAll();
    } catch (e) {
      this.actionError.set(e instanceof Error ? e.message : 'No se pudo vincular.');
    } finally {
      this.saving.set(false);
    }
  }

  iniciarAprobar() {
    this.actionError.set('');
    void this.loadStock(this.bodegaId());
    this.mode.set('aprobar');
  }

  /** AT7 — el mapeador emite los renglones ya resueltos al catálogo. */
  onItemsChange(items: ReqItemMap[]) {
    this.mappedItems.set(items);
  }
  iniciarRechazar() {
    this.actionError.set('');
    this.mode.set('rechazar');
  }
  volverVer() {
    this.actionError.set('');
    this.mode.set('ver');
  }

  async confirmarAprobar() {
    const s = this.selected();
    if (!s || this.saving()) return;
    if (!this.bodegaId()) {
      this.actionError.set('Elige el almacén desde el que se despacha.');
      return;
    }
    if (!this.fecha()) {
      this.actionError.set('Indica la fecha del despacho.');
      return;
    }
    const items = this.mappedItems();
    if (!items.length) {
      this.actionError.set('La requisición no tiene renglones que aprobar.');
      return;
    }
    // BT8 (nota #48: "si no he despachado algo pueda colocarlo en cero"): 0 = "no se
    // despacha ahora" → el renglón queda pendiente (el servidor lo salta y mantiene el
    // pendiente). Solo se bloquea si NO hay nada que despachar, o si hay negativos/NaN.
    if (items.some((i) => !Number.isFinite(i.cantidad) || i.cantidad < 0)) {
      this.actionError.set('Las cantidades no pueden ser negativas.');
      return;
    }
    if (items.every((i) => !(i.cantidad > 0))) {
      this.actionError.set('Selecciona al menos un renglón a despachar (deja en cero lo que no despachas ahora).');
      return;
    }
    // Un mismo artículo mapeado no puede repetirse (el despacho fallaría al sumar stock).
    const mapped = items.map((i) => i.articulo_id).filter((x): x is string => !!x);
    if (new Set(mapped).size !== mapped.length) {
      this.actionError.set('Un mismo artículo está mapeado en más de un renglón. Combínalos en uno solo.');
      return;
    }
    this.saving.set(true);
    this.actionError.set('');
    try {
      // AT7 — se envían los renglones YA mapeados al catálogo (preselección + fuzzy +
      // agregados por el aprobador). El servidor despacha lo que hay en stock y crea la
      // compra por el faltante y por los renglones que quedaron sin artículo.
      const res = await this.service.aprobarRequisicion(s.id, {
        bodega_id: this.bodegaId(),
        fecha: this.fecha(),
        responsable: this.responsable().trim() || null,
        responsable_id: this.responsableId(),
        observaciones: this.observaciones().trim() || null,
        items: items.map((i) => ({
          articulo_id: i.articulo_id,
          descripcion: i.descripcion,
          unidad: i.unidad,
          cantidad: i.cantidad,
          talla: i.talla ?? null,
        })),
      });
      const partes: string[] = [];
      if (res.despachado_total > 0) partes.push('despacho generado');
      if (res.solicitud_compra_id) partes.push('compra automática por el faltante');
      this.toast.success(
        'Requisición aprobada',
        partes.length ? partes.join(' + ') : undefined,
      );
      this.drawerOpen.set(false);
      await this.loadAll();
    } catch (e: unknown) {
      const msg = e instanceof Error ? humanizeError(e).mensaje : 'Error al aprobar la requisición.';
      this.actionError.set(msg);
      this.toast.error('No se pudo aprobar', msg);
    } finally {
      this.saving.set(false);
    }
  }

  async confirmarRechazar() {
    const s = this.selected();
    if (!s || this.saving()) return;
    this.saving.set(true);
    this.actionError.set('');
    try {
      await this.service.rechazar(s.id, this.rechazoNota().trim() || null);
      this.toast.info('Requisición rechazada');
      this.drawerOpen.set(false);
      await this.loadAll();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Error al rechazar la requisición.';
      this.actionError.set(msg);
      this.toast.error('No se pudo rechazar', msg);
    } finally {
      this.saving.set(false);
    }
  }

  // ── Filtros helpers ───────────────────────────────────────
  clearFilters() {
    this.fObra.set('');
    this.fSolicitante.set('');
    this.fEstado.set('');
    this.fUrgencia.set('');
    this.fDesde.set('');
    this.fHasta.set('');
    this.fArticulo.set('');
    this.search.set('');
    this.soloConNecesidad.set(false); // BO8
  }

  async exportar() {
    const rows = this.ordenadas().map((r) => ({
      Código: this.codigo(r),
      Fecha: this.formatFecha(r.created_at),
      Necesidad: r.fecha_necesidad ? this.formatFecha(r.fecha_necesidad) : '', // BO8
      Obra: r.proyecto?.nombre ?? '',
      Solicitante: this.solicitanteNombre(r) === '—' ? '' : this.solicitanteNombre(r),
      Rol: this.rolSolicitante(r),
      Urgencia: r.urgencia === 'urgente' ? 'Urgente' : 'Normal',
      Artículos: this.itemsCount(r),
      Estado: this.estadoLabel(r.estado),
      Notas: r.notas ?? '',
    }));
    await exportarExcel('requisiciones', rows);
  }
}
