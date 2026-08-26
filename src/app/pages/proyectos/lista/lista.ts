import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  computed,
  OnInit,
} from '@angular/core';
import {
  AbstractControl,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  ValidationErrors,
  ValidatorFn,
  Validators,
} from '@angular/forms';
import { DecimalPipe, NgTemplateOutlet } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ProyectosService } from '../../../../shared/services/proyectos.service';
import { UbicacionRdService, Provincia, Municipio, Sector, UbicacionMatch, ZONAS_RD } from '../../../../shared/services/ubicacion-rd.service';
import { PersonalObraService } from '../../../../shared/services/personal-obra.service';
import { PersonalConteos } from '../../../../shared/models/personal-obra.model';
import { DatosPruebaService } from '../../../../shared/services/datos-prueba.service';
import { DatosPruebaViewService } from '../../../../shared/services/datos-prueba-view.service';
import { ProyectoEstructurasService, ProyectoEstructura } from '../../../../shared/services/proyecto-estructuras.service';
import {
  FaseProyecto,
  Proyecto,
  ProyectoEmpleado,
  ProyectoReadiness,
  READINESS_ESTRELLAS,
  contarEstrellas,
  PROYECTO_ESTADOS,
  PROYECTO_TIPOS,
  FASE_ESTADOS,
  ROLES_PROYECTO,
  ROLES_OBRA,
  rolObraLabel,
  ProyectoResponsableLite,
  TipoResponsabilidad,
  TIPOS_RESPONSABILIDAD,
} from '../../../../shared/models/proyecto.model';
import { ProyectoAvance } from '../../../../shared/models/proyecto-partida.model';
import { Empleado } from '../../../../shared/models/empleado.model';
import { EmpleadosService } from '../../../../shared/services/empleados.service';
import { BodegasService } from '../../../../shared/services/bodegas.service';
import { ToastService } from '../../../../shared/services/toast.service';
import { FormDrawer } from '../../../../shared/components/form-drawer/form-drawer';
import { Skeleton } from '../../../../shared/components/skeleton/skeleton';
import { DocumentosProyecto } from '../../../../shared/components/documentos-proyecto/documentos-proyecto';
import { ExpedienteObra } from '../../../../shared/components/expediente-obra/expediente-obra';
import { CuadreObraComponent } from '../../../../shared/components/cuadre-obra/cuadre-obra';
import { EjecucionObra } from '../../../../shared/components/ejecucion-obra/ejecucion-obra';
import { ProyectoPartidas } from '../../../../shared/components/proyecto-partidas/proyecto-partidas';
import { ClLiberacion } from '../../../../shared/components/cl-liberacion/cl-liberacion';
import { LocationPicker } from '../../../../shared/context/location-picker/location-picker';
import { WeatherCard } from '../../../../shared/context/weather-card/weather-card';
import { SupabaseService } from '../../../core/services/supabase.service';
import { UserService } from '../../../core/services/user.service';
import { formatFechaDisplay } from '../../../../shared/utils/fecha.util';
import { exportarExcel } from '../../../../shared/utils/exportar-excel.util';

interface UsuarioSimple {
  id: string;
  nombre: string;
}

function fechaOrdenValidator(startKey: string, endKey: string): ValidatorFn {
  return (group: AbstractControl): ValidationErrors | null => {
    const start = group.get(startKey)?.value;
    const end = group.get(endKey)?.value;
    if (start && end && start > end) {
      return { fechaOrden: true };
    }
    return null;
  };
}

@Component({
  selector: 'app-lista',
  imports: [Skeleton, ReactiveFormsModule, FormDrawer, DecimalPipe, NgTemplateOutlet, DocumentosProyecto, ExpedienteObra, CuadreObraComponent, EjecucionObra, ProyectoPartidas, ClLiberacion, LocationPicker, WeatherCard, RouterLink],
  templateUrl: './lista.html',
  styleUrl: './lista.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Lista implements OnInit {
  private proyectosService = inject(ProyectosService);
  private ubicacionRd = inject(UbicacionRdService); // AU4
  private estructurasService = inject(ProyectoEstructurasService);
  private personalObraService = inject(PersonalObraService); // AR1

  // Z14 — estructuras (bloques/pisos) de la obra
  estructuras = signal<ProyectoEstructura[]>([]);
  nuevaEstructura = signal('');
  private empleadosService = inject(EmpleadosService);
  private bodegasService = inject(BodegasService);
  private supabase = inject(SupabaseService);
  private userService = inject(UserService);
  private toast = inject(ToastService);
  // Z5(d) — datos de prueba (mismo patrón que Flota).
  private datosPrueba = inject(DatosPruebaService);
  private datosPruebaViewSvc = inject(DatosPruebaViewService);
  /** Toggle GLOBAL "Ver datos de prueba" (compartido con el shell y demás listas). */
  mostrarPrueba = this.datosPruebaViewSvc.ver;
  /** Solo un admin puede marcar/ver/eliminar datos de prueba. */
  esAdmin = computed(() => this.userService.hasRole('admin'));

  /** AY4c — crear/editar proyectos: no el Ingeniero de Oficina (solo-lectura de la ficha). */
  puedeGestionarProyectos = this.userService.puedeGestionarProyectos;

  formatFecha = formatFechaDisplay;

  /** Cuadre + antifraude solo para roles financieros/dirección (no obra). */
  verCuadre = this.userService.verCuadre;

  /** AS7 — enlace a la bandeja global de requisiciones (solo quien puede verlas todas). */
  verRequisiciones = this.userService.puedeVerTodasRequisiciones;

  // ── R25: Pagado vs Trabajado ─────────────────────────────
  avance = signal<ProyectoAvance | null>(null);
  pagadoInput = signal<number | null>(null);
  avanceSaving = signal(false);
  /** Solo Admin/Dirección pueden fijar el % pagado; el resto lo ve read-only. */
  puedeEditarPagado = computed(
    () => this.userService.hasRole('admin') || this.userService.hasModulo('direccion'),
  );
  /** Z2 — gestionar responsables: admin o módulo Proyectos (coherente con RLS). */
  puedeGestionarResponsables = computed(
    () => this.userService.hasRole('admin') || this.userService.hasModulo('proyectos'),
  );

  // ── Data ─────────────────────────────────────────────────
  proyectos = signal<Proyecto[]>([]);
  usuarios = signal<UsuarioSimple[]>([]);
  empleados = signal<Empleado[]>([]);
  // A3.1 — catálogos para el cuadre (almacenes + artículos), cargados al abrir detalle.
  bodegasList = signal<{ id: string; nombre: string }[]>([]);
  articulosList = signal<{ id: string; nombre: string; codigo: string }[]>([]);
  loading = signal(true);
  saving = signal(false);
  error = signal('');
  saveError = signal('');

  // ── Sistema de estrellas: readiness por proyecto ─────────
  readiness = signal<Record<string, ProyectoReadiness>>({});
  /** Q1 — si el readiness se cargó bien; si no, no asumir 0 estrellas al validar. */
  private readinessLoaded = signal(false);
  readonly READINESS_ESTRELLAS = READINESS_ESTRELLAS;

  // ── Detail: real spend + team ─────────────────────────────
  gastoReal = signal<number>(0);
  equipo = signal<ProyectoEmpleado[]>([]);
  personalConteos = signal<PersonalConteos | null>(null); // AR1 — conteos de personal de obra
  equipoLoading = signal(false);
  // A3.2 — alta de miembro del Equipo de Obra
  nuevoMiembroRol = signal<string>('');
  nuevoMiembroModo = signal<'empleado' | 'externo'>('empleado');
  nuevoMiembroEmpleadoId = signal<string>('');
  nuevoMiembroExternoNombre = signal<string>('');
  nuevoMiembroExternoTipo = signal<string>('');
  nuevoMiembroDesde = signal<string>('');
  miembroError = signal<string>('');
  rolObraLabel = rolObraLabel;

  // ── Z2 — Ingenieros responsables vinculados a la obra ─────
  responsables = signal<ProyectoResponsableLite[]>([]);
  responsablesLoading = signal(false);
  nuevoRespUsuarioId = signal<string>('');
  nuevoRespTipo = signal<TipoResponsabilidad>('responsable');
  responsableError = signal<string>('');
  readonly TIPOS_RESPONSABILIDAD = TIPOS_RESPONSABILIDAD;

  // ── Filters ──────────────────────────────────────────────
  searchQuery = signal('');
  filterEstado = signal('');
  filterTipo = signal('');
  filterZona = signal('');
  // AU4 — cascada de locación + filtro por sector.
  filterSector = signal<number | null>(null);
  provincias = signal<Provincia[]>([]);
  municipios = signal<Municipio[]>([]);
  sectores = signal<Sector[]>([]);
  readonly zonasRd = ZONAS_RD;

  // AZ8 — buscador de ubicación con autocompletado ("punta cana" rellena la cascada).
  ubicBusqueda = signal('');
  ubicResultados = signal<UbicacionMatch[]>([]);
  ubicBuscando = signal(false);

  // AZ9 — catálogos para los selectores del equipo de obra (identidad real).
  ingenierosDisp = signal<{ id: string; nombre: string; roles: string }[]>([]);
  personalMaestros = signal<{ id: string; nombre: string; obra: string | null }[]>([]);
  puedeEditarLocacion = computed(() => this.userService.hasRole('admin') || this.userService.hasModulo('proyectos'));

  private route = inject(ActivatedRoute);
  private router = inject(Router);
  /** Z13 — se llegó por una ruta dedicada (/proyectos/:id o /proyectos/nuevo);
   *  al cerrar el detalle/formulario se vuelve al listado para mantener la URL. */
  private navegadoPorRuta = signal(false);
  /** Q5/Q2 — CL a enfocar en el detalle (deep-link ?proyecto=&cl= de una notificación). */
  clFocusId = signal<string | null>(null);
  clFocusRol = signal<string | null>(null);

  // ── Drawer: create/edit ──────────────────────────────────
  drawerOpen = signal(false);
  editingId = signal<string | null>(null);
  /** Q1 — estado del proyecto al abrir el drawer; el gate de estrellas solo
   *  aplica en la TRANSICIÓN hacia 'en_progreso', no al editar uno ya iniciado. */
  private editingEstadoOriginal = signal<string | null>(null);

  // ── Drawer: detail/fases ─────────────────────────────────
  detailDrawerOpen = signal(false);
  selectedProyecto = signal<Proyecto | null>(null);

  // Geolocation picked in the form (merged into the payload on save).
  formLat = signal<number | null>(null);
  formLng = signal<number | null>(null);
  formDireccionGeo = signal<string | null>(null);
  detailLoading = signal(false);

  // ── Fase form ─────────────────────────────────────────────
  faseDrawerOpen = signal(false);
  editingFaseId = signal<string | null>(null);
  faseSaving = signal(false);
  faseError = signal('');

  readonly PROYECTO_ESTADOS = PROYECTO_ESTADOS;
  readonly PROYECTO_TIPOS = PROYECTO_TIPOS;
  readonly ROLES_PROYECTO = ROLES_PROYECTO;
  readonly ROLES_OBRA = ROLES_OBRA;
  readonly FASE_ESTADOS = [
    { value: 'pendiente', label: 'Pendiente' },
    { value: 'en_progreso', label: 'En progreso' },
    { value: 'completada', label: 'Completada' },
  ];

  // ── Main form ─────────────────────────────────────────────
  form = new FormGroup(
    {
      codigo: new FormControl({ value: '', disabled: true }),
      nombre: new FormControl('', [Validators.required]),
      cliente: new FormControl<string | null>(null),
      tipo: new FormControl<string | null>(null),
      estado: new FormControl('planificacion', [Validators.required]),
      fecha_inicio: new FormControl<string | null>(null),
      fecha_fin_estimada: new FormControl<string | null>(null),
      presupuesto: new FormControl<number | null>(null, [Validators.min(0)]),
      ubicacion: new FormControl<string | null>(null),
      // AS23 — zona/sector para filtrar el listado (legacy texto libre; se conserva).
      zona: new FormControl<string | null>(null),
      // AU4 — locación estructurada en cascada.
      provincia_id: new FormControl<number | null>(null),
      municipio_id: new FormControl<number | null>(null),
      sector_id: new FormControl<number | null>(null),
      // AM10 — datos de obra estructurados (antes embutidos en la descripción).
      ingeniero_obra: new FormControl<string | null>(null),
      maestro_encargado: new FormControl<string | null>(null),
      // AZ9 — identidad real del equipo de obra (reemplaza el texto libre).
      ingeniero_obra_id: new FormControl<string | null>(null),
      maestro_ref: new FormControl<string | null>(null), // codificado "u:<id>" | "p:<id>"
      contacto_nombre: new FormControl<string | null>(null),
      contacto_telefono: new FormControl<string | null>(null),
      descripcion: new FormControl<string | null>(null),
      responsable_id: new FormControl<string | null>(null),
      // Z5(d) — dato de prueba (solo admin lo ve/edita).
      es_prueba: new FormControl<boolean>(false),
    },
    { validators: fechaOrdenValidator('fecha_inicio', 'fecha_fin_estimada') },
  );

  // ── Fase form ─────────────────────────────────────────────
  faseForm = new FormGroup(
    {
      nombre: new FormControl('', [Validators.required]),
      descripcion: new FormControl<string | null>(null),
      estado: new FormControl('pendiente', [Validators.required]),
      fecha_inicio: new FormControl<string | null>(null),
      fecha_fin: new FormControl<string | null>(null),
      progreso: new FormControl<number>(0, [Validators.min(0), Validators.max(100)]),
      orden: new FormControl<number>(1, [Validators.required, Validators.min(1)]),
    },
    { validators: fechaOrdenValidator('fecha_inicio', 'fecha_fin') },
  );

  // ── Computed ─────────────────────────────────────────────
  // AE1 — base FILTRADA de datos de prueba (helper central). Todo lo demás (lista + KPIs)
  // parte de aquí, así ni la lista ni las tarjetas cuentan proyectos de prueba.
  visiblesProy = computed(() => this.datosPruebaViewSvc.visibles(this.proyectos()));

  filtered = computed(() => {
    const q = this.searchQuery().toLowerCase().trim();
    const estado = this.filterEstado();
    const tipo = this.filterTipo();
    const zona = this.filterZona();
    const sector = this.filterSector();

    return this.visiblesProy().filter((p) => {
      if (sector != null && p.sector_id !== sector) return false;
      if (
        q &&
        !p.nombre.toLowerCase().includes(q) &&
        !p.codigo.toLowerCase().includes(q) &&
        !(p.cliente ?? '').toLowerCase().includes(q)
      ) {
        return false;
      }
      if (estado && p.estado !== estado) return false;
      if (tipo && p.tipo !== tipo) return false;
      if (zona && (p.zona ?? '') !== zona) return false;
      return true;
    });
  });

  // AS23 — zonas distintas presentes en los proyectos (para el filtro).
  zonasDisponibles = computed(() => {
    const set = new Set<string>();
    for (const p of this.visiblesProy()) {
      const z = (p.zona ?? '').trim();
      if (z) set.add(z);
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  });

  // AU4 — sectores presentes en los proyectos (para el filtro estructurado).
  sectoresDisponibles = computed(() => {
    const map = new Map<number, string>();
    for (const p of this.visiblesProy()) {
      if (p.sector_id != null && p.sector?.nombre) map.set(p.sector_id, p.sector.nombre);
    }
    return [...map.entries()].map(([id, nombre]) => ({ id, nombre })).sort((a, b) => a.nombre.localeCompare(b.nombre));
  });

  // AE1 — los KPIs NUNCA cuentan datos de prueba (salvo toggle admin, vía visiblesProy).
  statsTotal = computed(() => this.visiblesProy().length);
  statsEnProgreso = computed(() => this.visiblesProy().filter((p) => p.estado === 'en_progreso').length);
  statsCompletados = computed(() => this.visiblesProy().filter((p) => p.estado === 'completado').length);
  statsPresupuesto = computed(() =>
    this.visiblesProy().reduce((sum, p) => sum + (p.presupuesto ?? 0), 0),
  );

  drawerTitle = computed(() => (this.editingId() ? 'Editar proyecto' : 'Nuevo proyecto'));

  // ── Z13 — página completa (no drawer) ────────────────────
  /** Formulario de creación como PÁGINA (ruta /proyectos/nuevo). El de edición
   *  sigue siendo un drawer superpuesto sobre el listado o el detalle. */
  enPaginaCrear = computed(() => this.drawerOpen() && !this.editingId());
  /** Detalle del proyecto como PÁGINA (ruta /proyectos/:id) con pestañas. */
  enPaginaDetalle = computed(() => this.detailDrawerOpen() && !!this.selectedProyecto());
  /** Pestaña activa del detalle. */
  detalleTab = signal<string>('general');
  readonly DETALLE_TABS: { id: string; label: string; soloCuadre?: boolean }[] = [
    { id: 'general', label: 'General' },
    { id: 'equipo', label: 'Equipo y responsables' },
    { id: 'expediente', label: 'Expediente' },
    { id: 'cuadre', label: 'Cuadre inicial', soloCuadre: true },
    { id: 'ejecucion', label: 'Ejecución' },
    { id: 'partidas', label: 'Partidas' },
    { id: 'cl', label: 'Liberación (CL)' },
    { id: 'fases', label: 'Estructuras y fases' },
  ];
  /** Pestañas visibles (oculta "Cuadre" si el rol no puede verlo). */
  tabsVisibles = computed(() => this.DETALLE_TABS.filter((t) => !t.soloCuadre || this.verCuadre()));

  async ngOnInit() {
    this.wireCascada(); // AU4 — cascada provincia→municipio→sector del form
    await Promise.all([
      this.loadProyectos(),
      this.loadUsuarios(),
      this.loadEmpleados(),
      this.loadReadiness(),
      this.loadAlmacenes(),
    ]);
    // Q3 — drill-down desde el dashboard: filtrar por estado (?estado=en_progreso).
    const qp = this.route.snapshot.queryParamMap;
    const estado = qp.get('estado');
    if (estado) this.filterEstado.set(estado);
    // Q5/Q2 — deep-link LEGACY desde una notificación (?proyecto={id}&cl={reg}).
    // Z13 — se redirige a la ruta dedicada /proyectos/:id para no romper enlaces
    // viejos y dejar la URL consistente con la nueva página de detalle.
    const proyectoId = qp.get('proyecto');
    if (proyectoId) {
      this.router.navigate(['/proyectos', proyectoId], {
        queryParams: { cl: qp.get('cl'), firmaRol: qp.get('firmaRol') },
        replaceUrl: true,
      });
      return;
    }

    // Z13 — rutas dedicadas: /proyectos/nuevo (crear) y /proyectos/:id (detalle).
    const modo = this.route.snapshot.data['modo'];
    const idRuta = this.route.snapshot.paramMap.get('id');
    if (modo === 'crear') {
      this.navegadoPorRuta.set(true);
      this.openCreate();
    } else if (idRuta) {
      const p = this.proyectos().find((x) => x.id === idRuta);
      if (p) {
        this.navegadoPorRuta.set(true);
        const clId = qp.get('cl');
        this.clFocusId.set(clId);
        this.clFocusRol.set(qp.get('firmaRol'));
        // Si el enlace apunta a un CL, abrir directamente esa pestaña.
        this.detalleTab.set(clId ? 'cl' : 'general');
        this.openDetail(p);
      } else {
        // Deep-link a una obra inexistente/sin acceso: vuelve al listado.
        this.router.navigate(['/proyectos']);
      }
    }
  }

  /** Z13 — navega a la página de detalle de una obra (click/enter en la tarjeta). */
  verDetalle(id: string) {
    this.router.navigate(['/proyectos', id]);
  }

  /** Z13 — vuelve al listado desde la página de detalle o de creación. */
  volverListado() {
    this.router.navigate(['/proyectos']);
  }

  /** Z13 — al cerrar un detalle/formulario abierto por ruta dedicada, vuelve al
   *  listado para que la URL quede consistente (soporta el botón Atrás). */
  private volverAlListadoSiEsRuta() {
    if (this.navegadoPorRuta()) {
      this.navegadoPorRuta.set(false);
      this.router.navigate(['/proyectos']);
    }
  }

  /** Carga el readiness (estrellas) de cada proyecto — best-effort, no bloquea. */
  private async loadReadiness() {
    try {
      const rows = await this.proyectosService.getReadiness();
      const map: Record<string, ProyectoReadiness> = {};
      for (const r of rows) map[r.proyecto_id] = r;
      this.readiness.set(map);
      this.readinessLoaded.set(true);
    } catch {
      // non-blocking: sin readiness las tarjetas muestran 0 estrellas
      this.readinessLoaded.set(false);
    }
  }

  // ── Estrellas / readiness ────────────────────────────────
  readinessDe(proyectoId: string): ProyectoReadiness | undefined {
    return this.readiness()[proyectoId];
  }

  estrellas(proyectoId: string): number {
    return contarEstrellas(this.readiness()[proyectoId]);
  }

  listoParaIniciar(proyectoId: string): boolean {
    return this.estrellas(proyectoId) === 4;
  }

  private async loadEmpleados() {
    try {
      const all = await this.empleadosService.getAll();
      this.empleados.set(all.filter((e) => e.activo));
    } catch {
      // non-blocking
    }
  }

  empleadosDisponibles = computed(() => {
    const asignados = new Set(this.equipo().map((e) => e.empleado_id));
    return this.empleados().filter((e) => !asignados.has(e.id));
  });

  private async loadProyectos() {
    this.loading.set(true);
    this.error.set('');
    try {
      this.proyectos.set(await this.proyectosService.getAll());
      // R25 — evaluar avisos de pago>trabajo una sola vez al cargar (idempotente, no bloquea).
      try {
        await this.proyectosService.evaluarAvisosProyecto();
      } catch {
        // best-effort: la evaluación de avisos nunca bloquea la lista
      }
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'Error al cargar proyectos.');
    } finally {
      this.loading.set(false);
    }
  }

  private async loadUsuarios() {
    const { data } = await this.supabase.client
      .schema('sgc')
      .from('usuarios')
      .select('id, nombre')
      .eq('activo', true)
      .order('nombre');
    this.usuarios.set((data ?? []) as unknown as UsuarioSimple[]);
  }

  // ── Filters ──────────────────────────────────────────────
  onSearch(value: string) {
    this.searchQuery.set(value);
  }

  onEstadoChange(value: string) {
    this.filterEstado.set(value);
  }

  onTipoChange(value: string) {
    this.filterTipo.set(value);
  }

  onZonaChange(value: string) {
    this.filterZona.set(value);
  }

  clearFilters() {
    this.searchQuery.set('');
    this.filterEstado.set('');
    this.filterTipo.set('');
    this.filterZona.set('');
    this.filterSector.set(null);
  }

  /**
   * Exporta los proyectos filtrados a Excel. El gasto real y el % pagado se
   * cargan por proyecto solo al abrir su detalle, por lo que no están
   * disponibles a nivel de listado y no se incluyen aquí.
   */
  async exportar() {
    const rows = this.filtered().map((p) => ({
      Código: p.codigo,
      Nombre: p.nombre,
      Cliente: p.cliente ?? '',
      Tipo: p.tipo ? this.getTipoLabel(p.tipo) : '',
      Estado: this.getEstadoLabel(p.estado),
      Presupuesto: p.presupuesto ?? '',
      'Avance %': this.getProgresoPromedio(p),
      Estrellas: this.estrellas(p.id),
    }));
    await exportarExcel('proyectos', rows);
  }

  // ── Create/Edit Drawer ───────────────────────────────────
  openCreate() {
    this.editingId.set(null);
    this.editingEstadoOriginal.set(null);
    this.saveError.set('');
    this.form.reset({ estado: 'planificacion', es_prueba: false });
    this.formLat.set(null);
    this.formLng.set(null);
    this.formDireccionGeo.set(null);
    this.municipios.set([]);
    this.sectores.set([]);
    void this.ensureProvincias();
    void this.ensureEquipoCatalogos();
    this.drawerOpen.set(true);
  }

  /** AU4 — carga el catálogo de provincias la primera vez que se abre el form. */
  private async ensureProvincias() {
    if (this.provincias().length === 0) {
      try { this.provincias.set(await this.ubicacionRd.getProvincias()); } catch { /* reintentable */ }
    }
  }

  /** AZ9 — carga los catálogos del equipo de obra (ingenieros + personal para maestro). */
  private async ensureEquipoCatalogos() {
    if (this.ingenierosDisp().length === 0) {
      try { this.ingenierosDisp.set(await this.proyectosService.getIngenierosDisponibles()); } catch { /* reintentable */ }
    }
    if (this.personalMaestros().length === 0) {
      try {
        const personal = await this.personalObraService.listar();
        this.personalMaestros.set(
          personal
            .filter((p) => p.estado === 'activo')
            .map((p) => ({ id: p.id, nombre: `${p.nombre} ${p.apellido ?? ''}`.trim(), obra: p.proyecto?.nombre ?? null })),
        );
      } catch { /* reintentable */ }
    }
  }

  onUbicacionChange(u: { latitud: number; longitud: number; direccion: string }) {
    this.formLat.set(u.latitud);
    this.formLng.set(u.longitud);
    this.formDireccionGeo.set(u.direccion);
  }

  // ── AU4 — cascada provincia → municipio → sector ─────────────────────────────
  // `suppressCascade` evita que el reset programático de openEdit borre municipio/sector.
  private suppressCascade = false;

  private wireCascada() {
    this.form.controls.provincia_id.valueChanges.subscribe(async (pid) => {
      if (this.suppressCascade) return;
      this.form.patchValue({ municipio_id: null, sector_id: null }, { emitEvent: false });
      this.municipios.set([]);
      this.sectores.set([]);
      if (pid) {
        this.municipios.set(await this.ubicacionRd.getMunicipios(pid));
        // AZ8 — deriva la zona de la provincia (sin pisar un override ya escrito).
        const prov = this.provincias().find((x) => x.id === pid);
        const zc = this.form.get('zona');
        if (prov?.zona && !((zc?.value ?? '') as string).trim()) zc?.setValue(prov.zona, { emitEvent: false });
      }
    });
    this.form.controls.municipio_id.valueChanges.subscribe(async (mid) => {
      if (this.suppressCascade) return;
      this.form.patchValue({ sector_id: null }, { emitEvent: false });
      this.sectores.set([]);
      if (mid) this.sectores.set(await this.ubicacionRd.getSectores(mid));
    });
  }

  // ── AZ8 — buscador de ubicación con autocompletado ───────────────────────────
  async buscarUbicacion(q: string) {
    this.ubicBusqueda.set(q);
    if (q.trim().length < 2) { this.ubicResultados.set([]); return; }
    this.ubicBuscando.set(true);
    try {
      this.ubicResultados.set(await this.ubicacionRd.buscar(q));
    } catch { this.ubicResultados.set([]); }
    finally { this.ubicBuscando.set(false); }
  }

  /** Aplica un resultado del buscador: rellena provincia/municipio/sector y la zona. */
  async seleccionarUbicacion(m: UbicacionMatch) {
    this.suppressCascade = true;
    this.municipios.set(m.provincia_id ? await this.ubicacionRd.getMunicipios(m.provincia_id) : []);
    this.sectores.set(m.municipio_id ? await this.ubicacionRd.getSectores(m.municipio_id) : []);
    this.form.patchValue(
      {
        provincia_id: m.provincia_id,
        municipio_id: m.municipio_id,
        sector_id: m.sector_id,
        zona: m.zona ?? this.form.get('zona')?.value ?? null,
      },
      { emitEvent: false },
    );
    this.suppressCascade = false;
    this.ubicResultados.set([]);
    this.ubicBusqueda.set(m.label);
  }

  /** Crea un sector nuevo en el municipio elegido y lo selecciona. */
  async agregarSectorInline() {
    const municipioId = this.form.get('municipio_id')?.value;
    if (!municipioId || !this.puedeEditarLocacion()) return;
    const nombre = window.prompt('Nombre del nuevo sector:');
    if (!nombre?.trim()) return;
    try {
      const id = await this.ubicacionRd.agregarSector(municipioId, nombre.trim());
      this.sectores.set(await this.ubicacionRd.getSectores(municipioId));
      this.form.patchValue({ sector_id: id });
    } catch (e: unknown) {
      this.toast.error('No se pudo agregar el sector', e instanceof Error ? e.message : undefined);
    }
  }

  openEdit(p: Proyecto, event: Event) {
    event.stopPropagation();
    this.editingId.set(p.id);
    this.editingEstadoOriginal.set(p.estado);
    this.saveError.set('');
    // AU4 — no dejar que el reset dispare la cascada (borraría municipio/sector).
    this.suppressCascade = true;
    this.form.reset({
      codigo: p.codigo,
      nombre: p.nombre,
      cliente: p.cliente,
      tipo: p.tipo,
      estado: p.estado,
      fecha_inicio: p.fecha_inicio,
      fecha_fin_estimada: p.fecha_fin_estimada,
      presupuesto: p.presupuesto,
      ubicacion: p.ubicacion,
      zona: p.zona ?? null,
      ingeniero_obra: p.ingeniero_obra ?? null,
      maestro_encargado: p.maestro_encargado ?? null,
      // AZ9 — identidad real del equipo de obra
      ingeniero_obra_id: p.ingeniero_obra_id ?? null,
      maestro_ref: p.maestro_usuario_id ? `u:${p.maestro_usuario_id}` : (p.maestro_personal_id ? `p:${p.maestro_personal_id}` : null),
      contacto_nombre: p.contacto_nombre ?? null,
      contacto_telefono: p.contacto_telefono ?? null,
      descripcion: p.descripcion,
      responsable_id: p.responsable_id,
      es_prueba: p.es_prueba ?? false,
      provincia_id: p.provincia_id ?? null,
      municipio_id: p.municipio_id ?? null,
      sector_id: p.sector_id ?? null,
    });
    this.suppressCascade = false;
    this.formLat.set(p.latitud);
    this.formLng.set(p.longitud);
    this.formDireccionGeo.set(p.direccion_geo);
    this.drawerOpen.set(true);
    // AU4 — poblar las listas dependientes para que los selects muestren lo actual.
    void this.ensureProvincias();
    void this.ensureEquipoCatalogos();
    this.municipios.set([]);
    this.sectores.set([]);
    if (p.provincia_id) this.ubicacionRd.getMunicipios(p.provincia_id).then((m) => this.municipios.set(m));
    if (p.municipio_id) this.ubicacionRd.getSectores(p.municipio_id).then((s) => this.sectores.set(s));
  }

  /** Z13 — el drawer de EDICIÓN solo cierra (no navega); el detalle/listado
   *  detrás permanece. */
  cerrarEdicion() {
    this.drawerOpen.set(false);
    this.editingId.set(null);
  }

  /** Z13 — cancelar la creación (página /proyectos/nuevo) vuelve al listado. */
  cancelarCrear() {
    this.drawerOpen.set(false);
    this.volverListado();
  }

  /** Compat: cierre genérico usado por el drawer legacy. */
  closeDrawer() {
    if (this.enPaginaCrear()) {
      this.cancelarCrear();
      return;
    }
    this.cerrarEdicion();
  }

  async onSave() {
    this.form.markAllAsTouched();
    if (this.form.invalid || this.saving()) {
      if (this.form.errors?.['fechaOrden']) {
        this.saveError.set('La fecha de inicio no puede ser posterior a la fecha de fin estimada.');
      }
      return;
    }

    // Q1 — Gate del sistema de estrellas: SOLO en la transición hacia
    // 'en_progreso'. Editar datos de un proyecto ya iniciado (o sin cambiar de
    // estado) siempre guarda. Un proyecto nuevo arranca en 'planificacion'.
    const editId = this.editingId();
    const nuevoEstado = this.form.get('estado')?.value;
    const iniciandoObra =
      nuevoEstado === 'en_progreso' && this.editingEstadoOriginal() !== 'en_progreso';
    if (editId && iniciandoObra) {
      // Si el readiness no se pudo verificar, no asumir 0 estrellas: avisar en
      // vez de bloquear a ciegas.
      if (!this.readinessLoaded()) {
        this.saveError.set(
          'No se pudo verificar el estado de preparación (estrellas) del proyecto. Intenta recargar antes de iniciar la obra.',
        );
        return;
      }
      if (!this.listoParaIniciar(editId)) {
        this.saveError.set(
          'No se puede iniciar la obra: faltan estrellas (equipo, cuadre, expediente y almacén de obra).',
        );
        return;
      }
    }

    const id = this.editingId();
    const nuevoPrueba = !!this.form.get('es_prueba')?.value;
    const pruebaOriginal = id
      ? (this.proyectos().find((x) => x.id === id)?.es_prueba ?? false)
      : false;

    // Z5(d) — al MARCAR una obra existente como prueba, avisar cuántos derivados
    // (bitácoras, solicitudes, etc.) se arrastran en cascada.
    if (id && nuevoPrueba && !pruebaOriginal) {
      const n = await this.datosPrueba.contarDerivados('proyectos', id, true);
      if (
        n > 0 &&
        !confirm(
          `Esto también marcará como prueba ${n} registro(s) relacionado(s) de esta obra. ¿Continuar?`,
        )
      ) {
        return;
      }
    }

    this.saving.set(true);
    this.saveError.set('');
    // AM7 — la ubicación (lat/lng) NO viaja en el payload del update/insert: se
    // persiste aparte con la RPC canónica set_proyecto_ubicacion, que valida el
    // rango en el servidor (DR471/DR472). Un update() directo lo saltaría.
    const payload = { ...this.form.value } as Partial<Proyecto> & { maestro_ref?: string | null };

    // AZ9 — traduce los selectores del equipo a vínculos reales + sincroniza el texto de display.
    const ingId = payload.ingeniero_obra_id ?? null;
    if (ingId) {
      const ing = this.ingenierosDisp().find((i) => i.id === ingId);
      if (ing) payload.ingeniero_obra = ing.nombre; // mantiene el texto legado en sync para tarjetas/reportes
    }
    const mref = payload.maestro_ref ?? null;
    payload.maestro_usuario_id = null;
    payload.maestro_personal_id = null;
    if (mref?.startsWith('u:')) {
      const uid = mref.slice(2);
      payload.maestro_usuario_id = uid;
      const u = this.ingenierosDisp().find((i) => i.id === uid);
      if (u) payload.maestro_encargado = u.nombre;
    } else if (mref?.startsWith('p:')) {
      const pid = mref.slice(2);
      payload.maestro_personal_id = pid;
      const per = this.personalMaestros().find((x) => x.id === pid);
      if (per) payload.maestro_encargado = per.nombre;
    }
    delete payload.maestro_ref; // campo de UI, no columna

    const lat = this.formLat();
    const lng = this.formLng();
    const dir = this.formDireccionGeo();
    const tieneCoords = lat != null && lng != null;

    try {
      if (id) {
        // Fija/valida la ubicación primero; si está fuera de rango, aborta antes
        // de tocar los demás campos.
        if (tieneCoords) {
          await this.proyectosService.setUbicacion(id, lat!, lng!, dir, 'pin');
        }
        // update() vuelve a SELECT tras la RPC, así que trae ya la ubicación nueva.
        const updated = await this.proyectosService.update(id, payload);
        // AZ9 — el ingeniero de obra elegido queda como responsable real (alimenta AY4).
        if (ingId) { try { await this.proyectosService.ensureResponsable(id, ingId); } catch { /* best-effort */ } }
        this.proyectos.update((list) => list.map((p) => (p.id === id ? { ...p, ...updated } : p)));
        // Reflejar la edición en el detalle abierto (Z13 — página de detalle).
        this.selectedProyecto.update((sp) => (sp && sp.id === id ? { ...sp, ...updated } : sp));
        // Z5(d) — si cambió el flag de prueba, propagar la cascada server-side.
        if (nuevoPrueba !== pruebaOriginal) {
          try {
            await this.datosPrueba.marcar('proyectos', id, nuevoPrueba);
          } catch {
            /* best-effort: la columna ya quedó guardada por el update */
          }
        }
        this.cerrarEdicion();
      } else {
        const created = await this.proyectosService.create(payload);
        // AZ9 — el ingeniero de obra elegido queda como responsable real (alimenta AY4).
        if (ingId) { try { await this.proyectosService.ensureResponsable(created.id, ingId); } catch { /* best-effort */ } }
        // AM7 — ya con id, fija la ubicación vía RPC (misma validación que la app).
        if (tieneCoords) {
          try {
            await this.proyectosService.setUbicacion(created.id, lat!, lng!, dir, 'pin');
            created.latitud = lat;
            created.longitud = lng;
            created.direccion_geo = dir;
          } catch (e: unknown) {
            this.toast.error(
              'La obra se creó, pero no se pudo guardar la ubicación',
              e instanceof Error ? e.message : undefined,
            );
          }
        }
        this.proyectos.update((list) => [created, ...list]);
        this.drawerOpen.set(false);
        this.editingId.set(null);
        // Z13 — tras crear, ir a la PÁGINA de detalle de la nueva obra. Ahí el
        // banner "sin almacén" (Z21) ofrece crear el almacén de la obra.
        this.router.navigate(['/proyectos', created.id]);
      }
    } catch (e: unknown) {
      this.saveError.set(e instanceof Error ? e.message : 'Error al guardar.');
    } finally {
      this.saving.set(false);
    }
  }

  /** Z5(d) — elimina definitivamente una obra marcada como prueba (solo admin). */
  async eliminarPrueba(p: Proyecto, event: Event) {
    event.stopPropagation();
    if (!this.esAdmin() || !p.es_prueba) return;
    if (!confirm(`¿Eliminar la obra de prueba "${p.nombre}" y todos sus datos derivados? Esta acción no se puede deshacer.`)) {
      return;
    }
    try {
      await this.datosPrueba.eliminar('proyectos', p.id);
      this.proyectos.update((list) => list.filter((x) => x.id !== p.id));
      this.toast.success('Obra de prueba eliminada');
    } catch (e: unknown) {
      this.toast.error('No se pudo eliminar', e instanceof Error ? e.message : undefined);
    }
  }

  // ── Z21 — almacén obligatorio por obra ─────────────────────
  /** Proyecto recién creado pendiente de decidir su almacén (dispara el diálogo). */
  almacenPrompt = signal<Proyecto | null>(null);
  creandoAlmacen = signal(false);
  cerrandoObra = signal(false); // AT19
  /** IDs de proyecto que ya tienen almacén (Z21 faltantes). */
  proyectosConAlmacen = signal<Set<string>>(new Set());
  /** Banner admin de obras sin almacén: expandido/colapsado. */
  faltantesAlmacenAbierto = signal(false);

  /** Obras activas/planificación sin almacén (no incluye completadas/canceladas). */
  obrasSinAlmacen = computed(() => {
    const con = this.proyectosConAlmacen();
    return this.proyectos().filter(
      (p) => !con.has(p.id) && p.estado !== 'completado' && p.estado !== 'cancelado',
    );
  });

  private async loadAlmacenes() {
    try {
      this.proyectosConAlmacen.set(new Set(await this.bodegasService.getProyectoIdsConAlmacen()));
    } catch {
      /* best-effort: sin esto, el banner de faltantes no aparece */
    }
  }

  /** Z21 — ¿la obra seleccionada en el detalle tiene almacén? */
  tieneAlmacen(proyectoId: string | null | undefined): boolean {
    return !!proyectoId && this.proyectosConAlmacen().has(proyectoId);
  }

  /** Crea "Almacén {obra}" ligado al proyecto (principal). Sirve al diálogo de alta
   *  y al banner/detalle de obras existentes sin almacén. */
  async crearAlmacenParaObra(proyecto?: Proyecto) {
    const proy = proyecto ?? this.almacenPrompt();
    if (!proy || this.creandoAlmacen()) return;
    this.creandoAlmacen.set(true);
    try {
      await this.bodegasService.create({
        nombre: `Almacén ${proy.nombre}`,
        descripcion: null,
        ubicacion: null,
        activo: true,
        proyecto_id: proy.id,
        es_principal: true,
        latitud: proy.latitud ?? null,
        longitud: proy.longitud ?? null,
      });
      this.toast.success('Almacén creado', `Se creó "Almacén ${proy.nombre}" para la obra.`);
      this.almacenPrompt.set(null);
      this.proyectosConAlmacen.update((s) => new Set(s).add(proy.id));
    } catch (e: unknown) {
      this.toast.error('No se pudo crear el almacén', e instanceof Error ? e.message : undefined);
    } finally {
      this.creandoAlmacen.set(false);
    }
  }

  descartarAlmacenPrompt() {
    this.almacenPrompt.set(null);
  }

  /** AT19 — cerrar (terminada) o reabrir una obra. Reversible, solo admin. Cerrar la
   *  saca de los selectores y KPIs de obras activas; su historial queda consultable. */
  async toggleCerrarObra(p: Proyecto) {
    if (this.cerrandoObra()) return;
    const cerrar = p.estado !== 'terminada';
    const msg = cerrar
      ? `¿Cerrar «${p.nombre}»? Saldrá de los selectores de obra y dejará de contar como activa. Su historial queda intacto y puedes reabrirla luego.`
      : `¿Reabrir «${p.nombre}»? Volverá a los selectores como obra en progreso.`;
    if (!confirm(msg)) return;
    this.cerrandoObra.set(true);
    try {
      await this.proyectosService.cerrarProyecto(p.id, cerrar);
      this.selectedProyecto.update((s) => (s ? { ...s, estado: cerrar ? 'terminada' : 'en_progreso', activo: !cerrar } : s));
      await this.loadProyectos();
      this.toast.success(cerrar ? 'Obra cerrada' : 'Obra reabierta', p.nombre);
    } catch (e: unknown) {
      this.toast.error('No se pudo cambiar el estado de la obra', e instanceof Error ? e.message : undefined);
    } finally {
      this.cerrandoObra.set(false);
    }
  }

  // ── Detail Drawer ────────────────────────────────────────
  async openDetail(p: Proyecto) {
    this.detailDrawerOpen.set(true);
    this.selectedProyecto.set(p);
    this.detailLoading.set(true);
    this.equipoLoading.set(true);
    this.responsablesLoading.set(true);
    this.gastoReal.set(0);
    this.equipo.set([]);
    this.responsables.set([]);
    this.personalConteos.set(null);
    this.avance.set(null);
    this.pagadoInput.set(null);
    this.estructuras.set([]);
    try {
      const [full, gasto, equipo, avance, responsables, estructuras] = await Promise.all([
        this.proyectosService.getById(p.id),
        this.proyectosService.getGastoReal(p.id),
        this.proyectosService.getEquipo(p.id),
        this.proyectosService.getAvanceById(p.id),
        this.proyectosService.getResponsables(p.id).catch(() => []),
        this.estructurasService.getByProyecto(p.id).catch(() => []),
      ]);
      this.selectedProyecto.set(full);
      this.gastoReal.set(gasto);
      this.equipo.set(equipo);
      this.avance.set(avance);
      this.pagadoInput.set(avance?.porcentaje_pagado ?? null);
      this.responsables.set(responsables);
      this.estructuras.set(estructuras);
    } catch {
      // keep basic data
    } finally {
      // AR1 — conteos de personal de obra (best-effort, no bloquea el detalle).
      this.personalObraService.conteos(p.id).then((c) => this.personalConteos.set(c), () => undefined);
      this.detailLoading.set(false);
      this.equipoLoading.set(false);
      this.responsablesLoading.set(false);
    }
    // A3.1 — catálogos para el cuadre (best-effort, no bloquea el detalle).
    if (this.bodegasList().length === 0 || this.articulosList().length === 0) {
      try {
        const [b, a] = await Promise.all([
          this.supabase.client.from('bodegas').select('id, nombre').eq('activo', true).order('nombre'),
          this.supabase.client.from('articulos').select('id, nombre, codigo').eq('activo', true).order('nombre'),
        ]);
        this.bodegasList.set((b.data ?? []) as { id: string; nombre: string }[]);
        this.articulosList.set((a.data ?? []) as { id: string; nombre: string; codigo: string }[]);
      } catch {
        /* catálogos: enrichment only */
      }
    }
  }

  closeDetailDrawer() {
    this.detailDrawerOpen.set(false);
    this.selectedProyecto.set(null);
    this.volverAlListadoSiEsRuta();
  }

  // ── Z14 — estructuras (bloques/pisos) de la obra ──────────
  async agregarEstructura() {
    const p = this.selectedProyecto();
    const nombre = this.nuevaEstructura().trim();
    if (!p || !nombre) return;
    try {
      const orden = (this.estructuras().at(-1)?.orden ?? 0) + 1;
      const e = await this.estructurasService.crear(p.id, nombre, orden);
      this.estructuras.update((list) => [...list, e]);
      this.nuevaEstructura.set('');
    } catch {
      /* noop */
    }
  }

  async eliminarEstructura(e: ProyectoEstructura) {
    try {
      await this.estructurasService.eliminar(e.id);
      this.estructuras.update((list) => list.filter((x) => x.id !== e.id));
    } catch {
      /* noop */
    }
  }

  // ── R25: guardar % pagado (Admin/Dirección) ───────────────
  async guardarPagado() {
    const p = this.selectedProyecto();
    if (!p || this.avanceSaving() || !this.puedeEditarPagado()) return;
    const val = this.pagadoInput();
    if (val != null && (val < 0 || val > 100)) {
      this.toast.error('El % pagado debe estar entre 0 y 100.');
      return;
    }
    this.avanceSaving.set(true);
    try {
      await this.proyectosService.setPorcentajePagado(p.id, val);
      const fresh = await this.proyectosService.getAvanceById(p.id);
      this.avance.set(fresh);
      this.pagadoInput.set(fresh?.porcentaje_pagado ?? null);
      this.toast.success('% pagado actualizado');
    } catch (e: unknown) {
      this.toast.error('No se pudo guardar el % pagado', e instanceof Error ? e.message : undefined);
    } finally {
      this.avanceSaving.set(false);
    }
  }

  // ── Equipo de Obra (A3.2) ──────────────────────────────────
  onNuevoMiembroChange(value: string) {
    this.nuevoMiembroEmpleadoId.set(value);
  }

  /** Al elegir rol, sugiere el modo (los roles externos → entidad externa). */
  onNuevoMiembroRolChange(value: string) {
    this.nuevoMiembroRol.set(value);
    const rol = ROLES_OBRA.find((r) => r.value === value);
    this.nuevoMiembroModo.set(rol?.externo ? 'externo' : 'empleado');
    if (rol?.value === 'topografo') this.nuevoMiembroExternoTipo.set('topografia');
    else if (rol?.value === 'subcontratista') this.nuevoMiembroExternoTipo.set('subcontratista');
  }

  setMiembroModo(modo: 'empleado' | 'externo') {
    this.nuevoMiembroModo.set(modo);
  }

  async addMiembro() {
    const proyecto = this.selectedProyecto();
    if (!proyecto) return;
    this.miembroError.set('');

    const rol = this.nuevoMiembroRol();
    if (!rol) {
      this.miembroError.set('Selecciona el rol del miembro.');
      return;
    }
    const modo = this.nuevoMiembroModo();
    const empleadoId = modo === 'empleado' ? this.nuevoMiembroEmpleadoId() : '';
    const externoNombre = modo === 'externo' ? this.nuevoMiembroExternoNombre().trim() : '';

    if (modo === 'empleado' && !empleadoId) {
      this.miembroError.set('Selecciona el empleado.');
      return;
    }
    if (modo === 'externo' && !externoNombre) {
      this.miembroError.set('Escribe el nombre de la entidad externa.');
      return;
    }

    try {
      const added = await this.proyectosService.addMiembro(proyecto.id, {
        empleado_id: empleadoId || null,
        externo_nombre: externoNombre || null,
        externo_tipo: modo === 'externo' ? this.nuevoMiembroExternoTipo() || 'otro' : null,
        rol,
        desde: this.nuevoMiembroDesde() || null,
        hasta: null,
        notas: null,
      });
      this.equipo.update((list) => [...list, added]);
      this.nuevoMiembroRol.set('');
      this.nuevoMiembroEmpleadoId.set('');
      this.nuevoMiembroExternoNombre.set('');
      this.nuevoMiembroExternoTipo.set('');
      this.nuevoMiembroDesde.set('');
      this.nuevoMiembroModo.set('empleado');
    } catch (e: unknown) {
      this.miembroError.set(e instanceof Error ? e.message : 'Error al agregar el miembro.');
    }
  }

  async removeMiembro(id: string) {
    const previous = this.equipo();
    this.equipo.update((list) => list.filter((m) => m.id !== id));
    try {
      await this.proyectosService.removeEmpleado(id);
    } catch (e: unknown) {
      console.error('Error removing team member:', e);
      this.equipo.set(previous);
    }
  }

  // ── Z2 — Responsables vinculados (firmantes de liberación) ─────────────────
  /** Usuarios que aún no están vinculados como responsables de la obra. */
  usuariosSinVincular() {
    const yaVinc = new Set(this.responsables().map((r) => r.usuario_id));
    return this.usuarios().filter((u) => !yaVinc.has(u.id));
  }

  async addResponsable() {
    const proyecto = this.selectedProyecto();
    if (!proyecto) return;
    this.responsableError.set('');
    const usuarioId = this.nuevoRespUsuarioId();
    if (!usuarioId) {
      this.responsableError.set('Selecciona el ingeniero.');
      return;
    }
    const tipo = this.nuevoRespTipo();
    try {
      await this.proyectosService.addResponsable(proyecto.id, usuarioId, tipo);
      const fresh = await this.proyectosService.getResponsables(proyecto.id);
      this.responsables.set(fresh);
      this.nuevoRespUsuarioId.set('');
      this.nuevoRespTipo.set('responsable');
    } catch (e: unknown) {
      this.responsableError.set(e instanceof Error ? e.message : 'Error al vincular el responsable.');
    }
  }

  async removeResponsable(id: string) {
    const previous = this.responsables();
    this.responsables.update((list) => list.filter((r) => r.id !== id));
    try {
      await this.proyectosService.removeResponsable(id);
    } catch (e: unknown) {
      console.error('Error removing responsable:', e);
      this.responsables.set(previous);
    }
  }

  tipoRespLabel(tipo: string): string {
    return TIPOS_RESPONSABILIDAD.find((t) => t.value === tipo)?.label ?? tipo;
  }

  /** AV3 — designa el ingeniero PRINCIPAL de la obra (uno solo). */
  async hacerPrincipal(usuarioId: string) {
    const proyecto = this.selectedProyecto();
    if (!proyecto) return;
    this.responsableError.set('');
    try {
      await this.proyectosService.setResponsablePrincipal(proyecto.id, usuarioId);
      this.responsables.set(await this.proyectosService.getResponsables(proyecto.id));
    } catch (e: unknown) {
      this.responsableError.set(e instanceof Error ? e.message : 'No se pudo designar el ingeniero principal.');
    }
  }

  /** Z2 — responsables activos embebidos, para mostrarlos en la tarjeta del listado.
   *  AZ9 — deduplica por persona: una misma persona con dos roles (responsable + residente)
   *  aparece UNA vez con sus dos roles, en vez de dos chips (bug de Torre Alpha). */
  responsablesActivos(p: Proyecto): { key: string; nombre: string; tipos: TipoResponsabilidad[] }[] {
    const porPersona = new Map<string, { key: string; nombre: string; tipos: TipoResponsabilidad[] }>();
    for (const r of p.responsables ?? []) {
      if (!r.activo) continue;
      const key = r.usuario_id ?? r.id;
      const nombre = r.usuario?.nombre ?? '—';
      const entry = porPersona.get(key) ?? { key, nombre, tipos: [] };
      if (!entry.tipos.includes(r.tipo_responsabilidad)) entry.tipos.push(r.tipo_responsabilidad);
      porPersona.set(key, entry);
    }
    return [...porPersona.values()];
  }

  /** AZ9 — etiqueta combinada de roles de una persona ("Ing. Responsable · Ing. Residente"). */
  rolesRespLabel(tipos: TipoResponsabilidad[]): string {
    return tipos.map((t) => this.tipoRespLabel(t)).join(' · ');
  }

  // ── Fase Drawer ──────────────────────────────────────────
  openNewFase() {
    this.editingFaseId.set(null);
    this.faseError.set('');
    const fases = this.selectedProyecto()?.fases ?? [];
    this.faseForm.reset({
      estado: 'pendiente',
      progreso: 0,
      orden: fases.length + 1,
    });
    this.faseDrawerOpen.set(true);
  }

  openEditFase(fase: FaseProyecto) {
    this.editingFaseId.set(fase.id);
    this.faseError.set('');
    this.faseForm.reset({
      nombre: fase.nombre,
      descripcion: fase.descripcion,
      estado: fase.estado,
      fecha_inicio: fase.fecha_inicio,
      fecha_fin: fase.fecha_fin,
      progreso: fase.progreso,
      orden: fase.orden,
    });
    this.faseDrawerOpen.set(true);
  }

  closeFaseDrawer() {
    this.faseDrawerOpen.set(false);
  }

  async onSaveFase() {
    this.faseForm.markAllAsTouched();
    if (this.faseForm.invalid || this.faseSaving()) {
      if (this.faseForm.errors?.['fechaOrden']) {
        this.faseError.set('La fecha de inicio no puede ser posterior a la fecha de fin.');
      }
      return;
    }

    const proyecto = this.selectedProyecto();
    if (!proyecto) return;

    this.faseSaving.set(true);
    this.faseError.set('');

    const payload = this.faseForm.value as Partial<FaseProyecto>;

    try {
      const faseId = this.editingFaseId();
      if (faseId) {
        const updated = await this.proyectosService.updateFase(faseId, payload);
        this.selectedProyecto.update((p) =>
          p
            ? {
                ...p,
                fases: (p.fases ?? []).map((f) => (f.id === faseId ? updated : f)),
              }
            : p,
        );
      } else {
        const newFase = await this.proyectosService.createFase({
          ...payload,
          proyecto_id: proyecto.id,
        });
        this.selectedProyecto.update((p) =>
          p ? { ...p, fases: [...(p.fases ?? []), newFase] } : p,
        );
      }
      this.faseDrawerOpen.set(false);
    } catch (e: unknown) {
      this.faseError.set(e instanceof Error ? e.message : 'Error al guardar la fase.');
    } finally {
      this.faseSaving.set(false);
    }
  }

  async deleteFase(faseId: string) {
    try {
      await this.proyectosService.deleteFase(faseId);
      this.selectedProyecto.update((p) =>
        p ? { ...p, fases: (p.fases ?? []).filter((f) => f.id !== faseId) } : p,
      );
    } catch (e: unknown) {
      // silently fail — user can retry
      console.error('Error deleting fase:', e);
    }
  }

  // ── Helpers ──────────────────────────────────────────────
  getEstadoLabel(value: string): string {
    return PROYECTO_ESTADOS.find((e) => e.value === value)?.label ?? value;
  }

  getFaseEstadoLabel(value: string): string {
    return FASE_ESTADOS.find((e) => e.value === value)?.label ?? value;
  }

  getFaseEstadoBadge(value: string): string {
    return FASE_ESTADOS.find((e) => e.value === value)?.badge ?? 'neutral';
  }

  getEstadoBadge(value: string): string {
    return PROYECTO_ESTADOS.find((e) => e.value === value)?.badge ?? 'neutral';
  }

  getTipoLabel(value: string): string {
    return PROYECTO_TIPOS.find((t) => t.value === value)?.label ?? value;
  }

  getProgresoPromedio(p: Proyecto): number {
    const fases = p.fases;
    if (!fases || fases.length === 0) return 0;
    return Math.round(fases.reduce((sum, f) => sum + f.progreso, 0) / fases.length);
  }

  get f() {
    return this.form.controls;
  }

  get ff() {
    return this.faseForm.controls;
  }
}
