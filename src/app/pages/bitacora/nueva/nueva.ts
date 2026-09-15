import {
  Component,
  ChangeDetectionStrategy,
  DestroyRef,
  inject,
  signal,
  computed,
  OnInit,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators, ValidatorFn } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { BitacoraService } from '../../../../shared/services/bitacora.service';
import { CronogramaService } from '../../../../shared/services/cronograma.service';
import { ProyectoEstructurasService } from '../../../../shared/services/proyecto-estructuras.service';
import { ProyectosService } from '../../../../shared/services/proyectos.service';
import { DatosPruebaViewService } from '../../../../shared/services/datos-prueba-view.service';
import { BitacoraCatalogosService } from '../../../../shared/services/bitacora-catalogos.service';
import { UnidadesService } from '../../../../shared/services/unidades.service';
import { Unidad } from '../../../../shared/models/unidad.model';
import { UserService } from '../../../core/services/user.service';
import { BorradoresWebService, BorradorMeta } from '../../../../shared/services/borradores-web.service';
import { ContextService } from '../../../../shared/context/context.service';
import { WeatherService } from '../../../../shared/context/weather.service';
import { Proyecto } from '../../../../shared/models/proyecto.model';
import {
  ACTIVIDADES,
  ESTRUCTURAS,
  RESTRICCIONES,
  BITACORA_TIPOS,
  BitacoraTipo,
  VISITANTE_TIPOS,
  INCIDENTE_TIPOS,
  INCIDENTE_GRAVEDADES,
  SUCESO_CATALOGO_TIPO,
  MOTIVOS_SIN_ACTIVIDAD,
  BitacoraDanoInput,
  BitacoraMoldeInput,
} from '../../../../shared/models/bitacora.model';
import { todayIso } from '../../../../shared/utils/fecha.util';
import { humanizeError } from '../../../../shared/utils/friendly-error.util';
import { ReportesUsuarioService } from '../../../../shared/services/reportes-usuario.service';
import { QtyStepper } from '../../../../shared/ui/qty-stepper/qty-stepper';
import { Skeleton } from '../../../../shared/components/skeleton/skeleton';
import { FileUpload } from '../../../../shared/ui/file-upload/file-upload';
import { Icon } from '../../../../shared/ui/icon/icon';
import { MoldeEsquema } from '../../../../shared/ui/molde-esquema/molde-esquema';
import { MoldeCompositor, CompositorFigura } from '../../../../shared/ui/molde-compositor/molde-compositor';
import { ArticuloPicker, ArticuloPickerSelection } from '../../../../shared/ui/articulo-picker/articulo-picker';
import { ArticulosService } from '../../../../shared/services/articulos.service';
import { CategoriasService } from '../../../../shared/services/categorias.service';
import { Articulo } from '../../../../shared/models/articulo.model';
import { Categoria } from '../../../../shared/models/categoria.model';

const DRAFT_KEY = 'sgc-bitacora-draft';

// S6 — mínimos de fotos (espejo del RPC; fáciles de ajustar).
const MIN_FOTOS_PARTE = 2;
const MIN_FOTOS_INCIDENTE = 1;
// Sentinela para "Otro" en el selector de suceso (S13).
const SUCESO_OTRO = '__OTRO__';

/** S7 — equipo alquilado con flags de retiro/daño. */
interface EquipoRow {
  equipo: string;
  uso: string;
  proveedor: string;
  para_retirar: boolean;
  danado: boolean;
  dano_detalle: string;
}

// BP4 — Daño de material o equipo PROPIO reportado en el parte diario. Las fotos
// (File[]) no se serializan al borrador; el resto sí.
interface DanoRow {
  tipo: 'material' | 'equipo_propio';
  // BP4 — material: artículo del catálogo (articulo_id) o texto libre (esOtro).
  articulo_id: string | null;
  esOtro: boolean;
  nombre: string; // material (molde/viga) o equipo propio, texto libre / nombre del artículo
  cantidad: number | null;
  unidad: string;
  detalle: string;
  solicita_retiro: boolean;
  fotos: File[];
}
type DanoDraft = Omit<DanoRow, 'fotos'>;

// BO9 — Lado (tramo) de un molde: medida real + medida de plano (cm). Un molde
// rectangular/circular lleva un solo tramo (implícito, lado 'A'); L/T/U pueden
// tener 2-3 lados con sus propias medidas y plano.
interface MoldeTramoForm {
  lado: string; // 'A' | 'B' | 'C'
  largo_cm: number | null;
  alto_cm: number | null;
  espesor_cm: number | null;
  plano_largo_cm: number | null;
  plano_alto_cm: number | null;
  plano_espesor_cm: number | null;
}

// BO9 — Molde: N tramos reales (cm) + medida de plano opcional. El esquema se dibuja solo.
interface MoldeRow {
  estructura: string;
  identificador: string;
  forma: 'rectangular' | 'L' | 'T' | 'U' | 'circular' | 'libre';
  tramos: MoldeTramoForm[];
  notas: string;
  fotos: File[];
  desdeCompositor?: boolean; // BQ8c — fila originada por el compositor (no se envía; solo para preservar las de la ficha al alternar de modo)
}
type MoldeDraft = Omit<MoldeRow, 'fotos'>;

// BO9 — etiquetas de lado en orden y tope de tramos por molde.
const MOLDE_LADOS = ['A', 'B', 'C'];
const MOLDE_MAX_TRAMOS = 3;
function nuevoMoldeTramo(lado: string): MoldeTramoForm {
  return {
    lado,
    largo_cm: null, alto_cm: null, espesor_cm: null,
    plano_largo_cm: null, plano_alto_cm: null, plano_espesor_cm: null,
  };
}

interface Draft {
  form: Record<string, unknown>;
  actividades: string[];
  restricciones: string[];
  cantidades?: Record<string, number | null>;
  unidades?: Record<string, string | null>;
  bloquesLista?: string[];
  bloqueActivo?: string;
  descripciones?: Record<string, string>;
  equipos?: EquipoRow[];
  danos?: DanoDraft[]; // BP4 — sin fotos (File no serializa)
  moldes?: MoldeDraft[]; // BO9 — sin fotos
  moldeModo?: 'ficha' | 'compositor'; // BQ8c
  compositorFiguras?: CompositorFigura[]; // BQ8c
  estructurasOtras?: string[];
  actividadesOtras?: Record<string, string[]>; // AZ6 — actividades libres por estructura
}

@Component({
  selector: 'app-bitacora-nueva',
  imports: [ReactiveFormsModule, RouterLink, QtyStepper, Skeleton, FileUpload, Icon, MoldeEsquema, MoldeCompositor, ArticuloPicker],
  templateUrl: './nueva.html',
  styleUrl: './nueva.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Nueva implements OnInit {
  private bitacoraService = inject(BitacoraService);
  private cronogramaService = inject(CronogramaService);
  private estructurasService = inject(ProyectoEstructurasService);
  // Y15 — tareas del cronograma del proyecto elegido (para enlazar la bitácora).
  tareasCronograma = signal<{ id: string; nombre: string }[]>([]);
  // Z14 — estructuras (bloques/pisos) definidas por la obra elegida.
  estructurasObra = signal<string[]>([]);
  private proyectosService = inject(ProyectosService);
  private datosPruebaView = inject(DatosPruebaViewService);
  private userService = inject(UserService);
  private borradores = inject(BorradoresWebService);
  // X13 — borradores web multi-instancia.
  private readonly MODULO_BORRADOR = 'bitacora';
  private draftId: string = crypto.randomUUID();
  enProceso = signal<BorradorMeta[]>([]);
  private router = inject(Router);
  private destroyRef = inject(DestroyRef);
  private contextService = inject(ContextService);
  private weatherService = inject(WeatherService);
  private catalogosService = inject(BitacoraCatalogosService);
  private unidadesService = inject(UnidadesService);
  private reportes = inject(ReportesUsuarioService);
  // BP4 — catálogo de artículos para el picker de material dañado (best-effort).
  private articulosService = inject(ArticulosService);
  private categoriasService = inject(CategoriasService);
  articulosCat = signal<Articulo[]>([]);
  categoriasCat = signal<Categoria[]>([]);

  // Default to the built-in lists, then override with the admin-managed catalog.
  estructuras = signal<readonly string[]>(ESTRUCTURAS);
  actividades = signal<readonly string[]>(ACTIVIDADES);
  // Q6 — catálogo de unidades de medida (activas) para el trabajo realizado.
  unidades = signal<Unidad[]>([]);
  restricciones = signal<{ value: string; label: string }[]>(RESTRICCIONES);
  // BN1 — la orden de trabajo tiene su propio flujo (dos firmas) en una página
  // dedicada; este wizard maneja los tres tipos de bitácora clásicos.
  readonly TIPOS = BITACORA_TIPOS.filter((t) => t.value !== 'orden_trabajo');
  readonly VISITANTE_TIPOS = VISITANTE_TIPOS;
  readonly INCIDENTE_TIPOS = INCIDENTE_TIPOS;
  readonly MOTIVOS_SIN_ACTIVIDAD = MOTIVOS_SIN_ACTIVIDAD;
  readonly INCIDENTE_GRAVEDADES = INCIDENTE_GRAVEDADES;
  readonly SUCESO_OTRO = SUCESO_OTRO;
  readonly minFotosParte = MIN_FOTOS_PARTE;
  readonly today = todayIso();
  readonly maxArchivos = this.bitacoraService.maxArchivos;

  // S13 — sucesos probables por subtipo (del catálogo).
  private sucesos = signal<{ incidente: string[]; accidente: string[]; equipo: string[] }>({
    incidente: [],
    accidente: [],
    equipo: [],
  });
  // Bridge reactivo para incidente_tipo (los FormControl.value no son reactivos con OnPush).
  incidenteSubtipo = signal<string | null>(null);
  sucesosActuales = computed<string[]>(() => {
    const sub = this.incidenteSubtipo();
    const key = sub ? SUCESO_CATALOGO_TIPO[sub] : null;
    if (key === 'suceso_accidente') return this.sucesos().accidente;
    if (key === 'suceso_equipo') return this.sucesos().equipo;
    if (key === 'suceso_incidente') return this.sucesos().incidente;
    return [];
  });

  proyectos = signal<Proyecto[]>([]);
  loading = signal(true);
  saving = signal(false);
  saveError = signal('');

  tipoActual = signal<BitacoraTipo>('parte_diario');
  // Z4 — bridge reactivo para "sin actividad" (OnPush).
  sinActividad = signal<boolean>(false);

  // X13 — multi-bloque REAL (paridad app): la actividad se captura por el BLOQUE
  // activo. Llave = `bloque|estructura|actividad`, así la misma actividad puede
  // registrarse en dos bloques distintos en el mismo parte.
  actividadesSeleccionadas = signal<Set<string>>(new Set());
  cantidadesActividad = signal<Record<string, number | null>>({});
  unidadesActividad = signal<Record<string, string | null>>({});
  // AW1 — actividades que permiten "se trabajó" sin cantidad exacta (por catálogo),
  // y estado por-línea de "cantidad aproximada (~)".
  actividadesSinCantidad = signal<ReadonlySet<string>>(new Set());
  aproximadaActividad = signal<Record<string, boolean>>({});
  // AX6 — "Otros": elementos trabajados que no están en el catálogo. PARIDAD CON LA
  // APP MÓVIL: el usuario agrega el elemento como una estructura MÁS de la matriz y
  // elige sus actividades igual que en cualquiera; se guarda con `estructura` = el
  // texto TAL CUAL (no un 'OTROS' mudo) → sale verbatim en los reportes y alimenta
  // el catálogo (promover los repetidos, ciclo AT11). Se mantiene aparte para que el
  // re-ranking del catálogo (que reemplaza `estructuras`) no borre lo agregado.
  estructurasOtras = signal<string[]>([]);
  otroNombre = signal('');
  /** Estructuras del catálogo + las "Otros" agregadas por el usuario (dedup). */
  estructurasVista = computed(() => {
    const base = this.estructuras();
    const lower = new Set(base.map((e) => e.toLowerCase()));
    return [...base, ...this.estructurasOtras().filter((e) => !lower.has(e.toLowerCase()))];
  });
  // AZ6 — actividades "Otros" (SEGUNDO nivel): actividades libres por estructura,
  // espejo de estructurasOtras. Clave = estructura → sus actividades libres. Se
  // guardan con `actividad` = el texto tal cual (sale verbatim en reportes y
  // alimenta el repositorio "Valores 'Otro'" vía trigger de BD por membresía).
  actividadesOtras = signal<Record<string, string[]>>({});
  otroActividadNombre = signal('');
  /** Actividades del catálogo + las "Otros" agregadas a ESTA estructura (dedup). */
  actividadesVista(estructura: string): string[] {
    const base = this.actividades();
    const lower = new Set(base.map((a) => a.toLowerCase()));
    const extra = this.actividadesOtras()[estructura] ?? [];
    return [...base, ...extra.filter((a) => !lower.has(a.toLowerCase()))];
  }
  // Bloques/entrepisos/sujetos capturados en este parte + el que se edita ahora.
  bloquesLista = signal<string[]>(['General']);
  bloqueActivo = signal<string>('General');
  restriccionesSeleccionadas = signal<Set<string>>(new Set());
  archivos = signal<File[]>([]);
  expandedEstructura = signal<string | null>(null);

  // W2 — equipos alquilados en uso (parte diario). Lista dinámica.
  equiposAlquilados = signal<EquipoRow[]>([]);
  /** Sugerencias de equipos usados antes (datalist), alimenta/lee otros_valores (U25). */
  equiposSugeridos = signal<string[]>([]);

  // BP4 — daños de material / equipo propio (parte diario). Lista dinámica.
  danos = signal<DanoRow[]>([]);
  // BO9 — moldes del día (parte diario). Lista dinámica.
  moldes = signal<MoldeRow[]>([]);
  moldeToleranciaCm = signal(2);
  // BQ8c — dos modos de captura: "Ficha" (default) y "Compositor" (lienzo de figuras).
  // Ambos escriben la MISMA lista `moldes` → el payload no cambia. El compositor
  // gestiona las filas `desdeCompositor`; las de la ficha se conservan al alternar.
  moldeModo = signal<'ficha' | 'compositor'>('ficha');
  compositorFiguras = signal<CompositorFigura[]>([]);

  // Daily-log controls carry required validators toggled off for visita/incidente.
  private readonly PARTE_CONTROLS = [
    'bloque_entrepiso',
    'ingeniero_responsable',
    'hora_fin_trabajo',
    'personal_carpinteria',
    'personal_acero',
    'trabajadores_casa',
  ] as const;

  form = new FormGroup({
    tipo: new FormControl<BitacoraTipo>('parte_diario', [Validators.required]),
    fecha: new FormControl(this.today, [Validators.required]),
    proyecto_id: new FormControl<string | null>(null, [Validators.required]),
    // X13 — bloque_entrepiso de cabecera ahora OPCIONAL (paridad app): actúa como
    // default del bloque 'General'; el multi-bloque se maneja con los chips.
    bloque_entrepiso: new FormControl('', [Validators.maxLength(100)]),
    ingeniero_responsable: new FormControl('', [Validators.required, Validators.maxLength(150)]),
    hora_fin_trabajo: new FormControl('', [Validators.required]),
    personal_carpinteria: new FormControl<number | null>(null, [Validators.required, Validators.min(0)]),
    personal_acero: new FormControl<number | null>(null, [Validators.required, Validators.min(0)]),
    trabajadores_casa: new FormControl<number | null>(null, [Validators.required, Validators.min(0)]),
    otro_personal: new FormControl<string | null>(null, [Validators.maxLength(500)]),
    comentarios: new FormControl<string | null>(null, [Validators.maxLength(2000)]),
    // Y15 — enlace opcional con una tarea del cronograma (evidencia).
    cronograma_tarea_id: new FormControl<string | null>(null),
    // Y15 — marcar la tarea como completada con una foto de esta bitácora.
    cronograma_completar: new FormControl<boolean>(false),
    descripcion_otro_restriccion: new FormControl<string | null>(null),
    // Clima + migración (R21/R22) — parte diario. La lluvia NO es un incidente.
    llovio: new FormControl<boolean>(false, { nonNullable: true }),
    lluvia_detalle: new FormControl<string | null>(null, [Validators.maxLength(1000)]),
    // Z5 — horas que la lluvia afectó el trabajo (0..24), solo si llovió.
    horas_lluvia: new FormControl<number | null>(null, [Validators.min(0), Validators.max(24)]),
    // Z4 — "No se trabajó en obra": el parte se registra solo con motivo.
    sin_actividad: new FormControl<boolean>(false, { nonNullable: true }),
    motivo_sin_actividad: new FormControl<string | null>(null),
    motivo_sin_actividad_detalle: new FormControl<string | null>(null, [Validators.maxLength(500)]),
    hubo_migracion: new FormControl<boolean>(false, { nonNullable: true }),
    migracion_obreros_texto: new FormControl<string | null>(null, [Validators.maxLength(2000)]),
    // Equipos alquilados (W2) — parte diario. La lista va aparte (equiposAlquilados).
    hubo_equipos: new FormControl<boolean>(false, { nonNullable: true }),
    // Visita
    visita_tipo_visitante: new FormControl<string | null>(null),
    visita_nombre: new FormControl<string | null>(null, [Validators.maxLength(150)]),
    visita_organizacion: new FormControl<string | null>(null, [Validators.maxLength(150)]),
    visita_motivo: new FormControl<string | null>(null, [Validators.maxLength(500)]),
    // Incidente
    incidente_tipo: new FormControl<string | null>(null),
    incidente_gravedad: new FormControl<string | null>(null),
    incidente_subcontratista: new FormControl<string | null>(null, [Validators.maxLength(150)]),
    incidente_lesionados: new FormControl<number | null>(0, [Validators.min(0)]),
    incidente_descripcion: new FormControl<string | null>(null, [Validators.maxLength(2000)]),
    incidente_acciones: new FormControl<string | null>(null, [Validators.maxLength(2000)]),
    // S12 — incidente de equipo
    incidente_equipo_nombre: new FormControl<string | null>(null, [Validators.maxLength(150)]),
    incidente_equipo_alquilado: new FormControl<string | null>(null), // 'propio' | 'alquilado'
    incidente_equipo_operativo: new FormControl<string | null>(null), // 'si' | 'no'
    // T19 — comentario de operatividad (obligatorio si quedó fuera de servicio).
    incidente_equipo_operativo_comentario: new FormControl<string | null>(null, [Validators.maxLength(1000)]),
    // S13 — suceso probable (valor del catálogo o SUCESO_OTRO) + texto libre
    incidente_suceso: new FormControl<string | null>(null),
    incidente_suceso_otro: new FormControl<string | null>(null, [Validators.maxLength(200)]),
  });

  activeProyectos = computed(() =>
    this.datosPruebaView.visibles(this.proyectos()).filter((p) => p.activo),
  );
  showOtroRestriccion = computed(() => this.restriccionesSeleccionadas().has('OTRO'));

  // U12 — descripción breve OBLIGATORIA por cada restricción seleccionada
  // (excepto "NINGUNA"). Mapa value→texto.
  restriccionDescripciones = signal<Record<string, string>>({});
  /** Restricciones seleccionadas que requieren descripción (todas menos NINGUNA). */
  restriccionesADescribir = computed(() =>
    [...this.restriccionesSeleccionadas()].filter((r) => r !== 'NINGUNA'),
  );
  restriccionLabel(value: string): string {
    return this.restricciones().find((r) => r.value === value)?.label ?? value;
  }
  /** S13 — muestra el suceso (catálogo en MAYÚS) de forma legible. */
  sucesoLabel(value: string): string {
    if (!value) return value;
    return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
  }
  getRestriccionDescripcion(value: string): string {
    return this.restriccionDescripciones()[value] ?? '';
  }
  setRestriccionDescripcion(value: string, texto: string) {
    this.restriccionDescripciones.update((m) => ({ ...m, [value]: texto }));
    this.saveDraft();
  }

  /** Toggle required validators to match the selected entry type. */
  onTipoChange(tipo: BitacoraTipo) {
    this.tipoActual.set(tipo);

    const numericos = ['personal_carpinteria', 'personal_acero', 'trabajadores_casa'];
    for (const name of this.PARTE_CONTROLS) {
      const ctrl = this.form.get(name)!;
      if (tipo === 'parte_diario') {
        ctrl.setValidators(numericos.includes(name) ? [Validators.required, Validators.min(0)] : [Validators.required]);
      } else {
        ctrl.clearValidators();
      }
      ctrl.updateValueAndValidity({ emitEvent: false });
    }

    const setReq = (name: string, required: boolean, extra: ValidatorFn[] = []) => {
      const ctrl = this.form.get(name)!;
      ctrl.setValidators(required ? [Validators.required, ...extra] : extra);
      ctrl.updateValueAndValidity({ emitEvent: false });
    };

    setReq('visita_tipo_visitante', tipo === 'visita');
    setReq('visita_nombre', tipo === 'visita', [Validators.maxLength(150)]);
    setReq('incidente_tipo', tipo === 'incidente');
    // Los validadores de los sub-campos del incidente dependen del subtipo (S12/S13).
    if (tipo === 'incidente') {
      this.onIncidenteTipoChange(this.form.controls.incidente_tipo.value);
    } else {
      this.onIncidenteTipoChange(null);
    }
  }

  /** Z4 — "No se trabajó en obra": relaja los campos del parte y exige solo el
   *  motivo. Al desmarcarlo, restaura los validadores normales del parte. */
  onSinActividadChange(on: boolean) {
    this.sinActividad.set(on);
    const motivo = this.form.controls.motivo_sin_actividad;
    if (on) {
      for (const name of this.PARTE_CONTROLS) {
        const ctrl = this.form.get(name)!;
        ctrl.clearValidators();
        ctrl.updateValueAndValidity({ emitEvent: false });
      }
      motivo.setValidators([Validators.required]);
    } else {
      motivo.clearValidators();
      motivo.setValue(null);
      this.form.controls.motivo_sin_actividad_detalle.setValue(null);
      // Restaura los validadores del parte diario.
      if (this.tipoActual() === 'parte_diario') this.onTipoChange('parte_diario');
    }
    motivo.updateValueAndValidity({ emitEvent: false });
    this.actualizarReqMotivoDetalle();
  }

  /** Z4 — el detalle del motivo es obligatorio cuando el motivo es "Otro".
   *  (formControlName ya actualiza el valor; solo re-sincroniza el validador). */
  actualizarReqMotivoDetallePublic() {
    this.actualizarReqMotivoDetalle();
  }

  private actualizarReqMotivoDetalle() {
    const req = this.sinActividad() && this.form.controls.motivo_sin_actividad.value === 'otro';
    const ctrl = this.form.controls.motivo_sin_actividad_detalle;
    ctrl.setValidators(req ? [Validators.required, Validators.maxLength(500)] : [Validators.maxLength(500)]);
    ctrl.updateValueAndValidity({ emitEvent: false });
  }

  /** S12/S13 — las preguntas del incidente cambian según el subtipo. */
  onIncidenteTipoChange(subtipo: string | null) {
    this.incidenteSubtipo.set(subtipo);

    const setReq = (name: string, required: boolean, extra: ValidatorFn[] = []) => {
      const ctrl = this.form.get(name)!;
      ctrl.setValidators(required ? [Validators.required, ...extra] : extra);
      ctrl.updateValueAndValidity({ emitEvent: false });
    };

    const esIncidente = subtipo != null; // hay un subtipo elegido
    // accidente → gravedad; equipo → nombre/propiedad/operativo; suceso siempre.
    setReq('incidente_gravedad', subtipo === 'accidente');
    setReq('incidente_descripcion', subtipo === 'accidente' || subtipo === 'incidente', [Validators.maxLength(2000)]);
    setReq('incidente_equipo_nombre', subtipo === 'incidente_equipo', [Validators.maxLength(150)]);
    setReq('incidente_equipo_alquilado', subtipo === 'incidente_equipo');
    setReq('incidente_equipo_operativo', subtipo === 'incidente_equipo');
    // T19 — comentario obligatorio solo si el equipo quedó fuera de servicio.
    this.actualizarReqComentarioOperatividad();
    setReq('incidente_suceso', esIncidente);
  }

  /** T19 — el comentario de operatividad es obligatorio si el equipo quedó fuera
   *  de servicio (subtipo incidente_equipo + operativo = 'no'). */
  private actualizarReqComentarioOperatividad() {
    const req =
      this.incidenteSubtipo() === 'incidente_equipo' &&
      this.form.controls.incidente_equipo_operativo.value === 'no';
    const ctrl = this.form.controls.incidente_equipo_operativo_comentario;
    ctrl.setValidators(req ? [Validators.required, Validators.maxLength(1000)] : [Validators.maxLength(1000)]);
    ctrl.updateValueAndValidity({ emitEvent: false });
  }

  /** T19 — sugerencias de equipos de ESTA obra (incidente de equipo + equipos
   *  alquilados). Si la obra tiene equipos, reemplaza el listado global; si no,
   *  conserva las sugerencias globales ya cargadas. */
  /**
   * AA11 — al elegir la obra, precarga el "ingeniero responsable" con el encargado
   * asignado del proyecto (responsable, o primer responsable activo). Solo si el
   * campo está vacío o aún tiene el default del usuario logueado (no pisa una
   * edición manual). Editable siempre.
   */
  private defaultIngenieroDeObra(proyectoId: string | null) {
    if (!proyectoId) return;
    const p = this.proyectos().find((x) => x.id === proyectoId);
    if (!p) return;
    const encargado =
      p.responsable?.nombre ??
      p.responsables?.find((r) => r.activo)?.usuario?.nombre ??
      null;
    if (!encargado) return;
    const actual = (this.form.controls.ingeniero_responsable.value ?? '').trim();
    const propio = (this.userService.profile()?.nombre ?? '').trim();
    if (!actual || actual === propio) {
      this.form.controls.ingeniero_responsable.setValue(encargado);
    }
  }

  private async loadEquiposDeObra(proyectoId: string | null) {
    if (!proyectoId) return;
    try {
      const deObra = await this.bitacoraService.getEquiposDeObra(proyectoId);
      if (deObra.length) this.equiposSugeridos.set(deObra);
    } catch {
      /* conserva las sugerencias globales */
    }
  }

  async ngOnInit() {
    this.form.controls.ingeniero_responsable.setValue(this.userService.profile()?.nombre ?? '');
    // X13 — cargar la lista de borradores "En proceso" (multi-instancia).
    this.refrescarEnProceso();
    // Migración suave del borrador viejo de slot único (sessionStorage) → lista.
    const legacy = sessionStorage.getItem(DRAFT_KEY);
    if (legacy) {
      try {
        this.borradores.save(this.MODULO_BORRADOR, this.draftId, 'Parte recuperado', JSON.parse(legacy));
      } catch { /* ignora */ }
      sessionStorage.removeItem(DRAFT_KEY);
      this.refrescarEnProceso();
    }

    this.form.controls.tipo.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((t) => this.onTipoChange((t ?? 'parte_diario') as BitacoraTipo));

    // Z4 — mantener validadores en sync también al restaurar un borrador.
    this.form.controls.sin_actividad.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((v) => this.onSinActividadChange(!!v));

    // S12/S13 — al cambiar el subtipo de incidente, ajusta preguntas + limpia suceso.
    this.form.controls.incidente_tipo.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((v) => {
        this.onIncidenteTipoChange(v ?? null);
        this.form.controls.incidente_suceso.setValue(null, { emitEvent: false });
        this.form.controls.incidente_suceso_otro.setValue(null, { emitEvent: false });
      });

    // T19 — al cambiar "¿queda operativo?", ajusta si el comentario es obligatorio.
    this.form.controls.incidente_equipo_operativo.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.actualizarReqComentarioOperatividad());

    // S2 — al elegir la obra, reordena estructuras/actividades por uso de esa obra.
    // T19 — y carga los equipos ya vistos en esa obra (selector/datalist).
    this.form.controls.proyecto_id.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((id) => {
        this.aplicarRanking(id ?? null);
        void this.loadEquiposDeObra(id ?? null);
        void this.loadTareasCronograma(id ?? null);
        void this.loadEstructuras(id ?? null);
        this.defaultIngenieroDeObra(id ?? null); // AA11
      });

    this.form.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => this.saveDraft());

    try {
      this.proyectos.set(await this.proyectosService.getAll());
    } catch (e: unknown) {
      this.saveError.set(e instanceof Error ? e.message : 'Error al cargar los proyectos.');
    } finally {
      this.loading.set(false);
    }

    // Override the built-in lists with the admin-managed catalog (best-effort).
    try {
      const cat = await this.catalogosService.getCatalogos();
      if (cat.estructuras.length) this.estructuras.set(cat.estructuras);
      if (cat.actividades.length) this.actividades.set(cat.actividades);
      if (cat.restricciones.length) this.restricciones.set(cat.restricciones);
      this.actividadesSinCantidad.set(new Set(cat.actividadesSinCantidad));
    } catch {
      /* keep the built-in lists */
    }

    // Q6 — catálogo de unidades de medida para el trabajo realizado (best-effort).
    try {
      this.unidades.set(await this.unidadesService.getActivas());
    } catch {
      /* sin unidades: el selector queda vacío, la cantidad sigue funcionando */
    }

    // W2 — sugerencias de equipos usados antes (datalist).
    try {
      this.equiposSugeridos.set(await this.bitacoraService.getEquiposSugeridos());
    } catch {
      /* sin sugerencias, no pasa nada */
    }
    // T19 — si ya hay obra elegida, prioriza los equipos de esa obra.
    void this.loadEquiposDeObra(this.form.controls.proyecto_id.value ?? null);

    // S13 — sucesos probables por subtipo (best-effort).
    try {
      this.sucesos.set(await this.catalogosService.getSucesos());
    } catch {
      /* sin catálogo de sucesos: el selector queda vacío, "Otro" sigue disponible */
    }

    // BP4 — catálogo de artículos para el picker de material dañado (best-effort;
    // si falla, el usuario igual puede escribir el material como "Otro").
    try {
      const [arts, cats] = await Promise.all([
        this.articulosService.getAll(),
        this.categoriasService.getAll(),
      ]);
      this.articulosCat.set(arts);
      this.categoriasCat.set(cats);
    } catch {
      /* sin catálogo: el picker permite igualmente escribir "Otro" */
    }
  }

  /** S2 — trae el catálogo con ranking de uso de la obra elegida (best-effort). */
  private async aplicarRanking(proyectoId: string | null) {
    if (!proyectoId) return;
    try {
      const cat = await this.catalogosService.getCatalogosOrdenados(proyectoId);
      if (cat.estructuras.length) this.estructuras.set(cat.estructuras);
      if (cat.actividades.length) this.actividades.set(cat.actividades);
      this.actividadesSinCantidad.set(new Set(cat.actividadesSinCantidad));
    } catch {
      /* mantiene el orden actual */
    }
  }

  // ── Borradores web (X13 — multi-instancia, localStorage) ───────────────────
  private refrescarEnProceso() {
    this.enProceso.set(this.borradores.list(this.MODULO_BORRADOR));
  }

  /** ¿El borrador actual tiene contenido que valga la pena guardar? */
  private tieneContenido(): boolean {
    const v = this.form.getRawValue();
    const hayOtros = this.estructurasOtras().length > 0;
    return !!(v.proyecto_id || this.actividadesSeleccionadas().size || this.restriccionesSeleccionadas().size
      || v.comentarios || v.incidente_descripcion || this.equiposAlquilados().length || this.danos().length || this.moldes().length || hayOtros);
  }

  private draftLabel(): string {
    const v = this.form.getRawValue();
    const proy = this.proyectos().find((p) => p.id === v.proyecto_id)?.nombre;
    const tipo = v.tipo === 'parte_diario' ? 'Parte' : v.tipo === 'incidente' ? 'Incidente' : 'Visita';
    return `${tipo}${proy ? ' · ' + proy : ''} · ${v.fecha ?? ''}`.trim();
  }

  private saveDraft() {
    if (!this.tieneContenido()) return; // no ensuciar la lista con borradores vacíos
    const draft: Draft = {
      form: this.form.getRawValue(),
      actividades: [...this.actividadesSeleccionadas()],
      restricciones: [...this.restriccionesSeleccionadas()],
      cantidades: this.cantidadesActividad(),
      unidades: this.unidadesActividad(),
      bloquesLista: this.bloquesLista(),
      bloqueActivo: this.bloqueActivo(),
      descripciones: this.restriccionDescripciones(),
      equipos: this.equiposAlquilados(),
      danos: this.danos().map(({ fotos, ...rest }) => rest), // fotos (File) no serializan
      moldes: this.moldes().map(({ fotos, ...rest }) => rest),
      moldeModo: this.moldeModo(), // BQ8c
      compositorFiguras: this.compositorFiguras(), // BQ8c
      estructurasOtras: this.estructurasOtras(),
      actividadesOtras: this.actividadesOtras(),
    };
    this.borradores.save(this.MODULO_BORRADOR, this.draftId, this.draftLabel(), draft);
    this.refrescarEnProceso();
  }

  /** Retoma un borrador de la lista "En proceso". */
  recuperar(id: string) {
    const draft = this.borradores.get<Draft>(this.MODULO_BORRADOR, id);
    if (!draft) return;
    this.draftId = id; // seguir editando ese borrador
    this.form.patchValue(draft.form);
    this.actividadesSeleccionadas.set(new Set(draft.actividades));
    this.restriccionesSeleccionadas.set(new Set(draft.restricciones));
    this.cantidadesActividad.set(draft.cantidades ?? {});
    this.unidadesActividad.set(draft.unidades ?? {});
    this.bloquesLista.set(draft.bloquesLista ?? ['General']);
    this.bloqueActivo.set(draft.bloqueActivo ?? this.bloquesLista()[0] ?? 'General');
    this.restriccionDescripciones.set(draft.descripciones ?? {});
    this.equiposAlquilados.set(draft.equipos ?? []);
    // BP4 — fotos se re-agregan; articulo_id/esOtro por defecto para borradores previos.
    this.danos.set((draft.danos ?? []).map((d) => ({ ...d, articulo_id: d.articulo_id ?? null, esOtro: d.esOtro ?? false, fotos: [] })));
    this.moldes.set((draft.moldes ?? []).map((m) => this.normalizarMoldeDraft(m))); // BO9 (soporta borradores legacy)
    this.moldeModo.set(draft.moldeModo ?? 'ficha'); // BQ8c
    this.compositorFiguras.set(draft.compositorFiguras ?? []); // BQ8c
    // AX6 — restaura las estructuras "Otros"; deriva las que falten de las llaves
    // `bloque|estructura|actividad` para que la matriz pinte sus grupos.
    const otras = new Set(draft.estructurasOtras ?? []);
    const enCatalogo = new Set(this.estructuras().map((e) => e.toLowerCase()));
    for (const k of draft.actividades ?? []) {
      const est = k.split('|')[1];
      if (est && !enCatalogo.has(est.toLowerCase())) otras.add(est);
    }
    this.estructurasOtras.set([...otras]);
    // AZ6 — restaura las actividades "Otros" por estructura; deriva las que falten
    // de las llaves `bloque|estructura|actividad` (actividad fuera del catálogo).
    const actOtras: Record<string, string[]> = { ...(draft.actividadesOtras ?? {}) };
    const actCatalogo = new Set(this.actividades().map((a) => a.toLowerCase()));
    for (const k of draft.actividades ?? []) {
      const [, est, act] = k.split('|');
      if (est && act && !actCatalogo.has(act.toLowerCase())) {
        const lista = actOtras[est] ?? [];
        if (!lista.some((a) => a.toLowerCase() === act.toLowerCase())) actOtras[est] = [...lista, act];
      }
    }
    this.actividadesOtras.set(actOtras);
  }

  descartar(id: string) {
    this.borradores.remove(this.MODULO_BORRADOR, id);
    if (id === this.draftId) this.draftId = crypto.randomUUID();
    this.refrescarEnProceso();
  }

  // ── Bloques (multi-bloque) ───────────────────────────────────
  agregarBloque(nombre: string) {
    const n = nombre.trim();
    if (!n) return;
    if (!this.bloquesLista().includes(n)) {
      this.bloquesLista.update((l) => [...l, n]);
    }
    this.bloqueActivo.set(n);
    this.saveDraft();
  }
  seleccionarBloque(b: string) {
    this.bloqueActivo.set(b);
  }
  quitarBloque(b: string) {
    if (this.bloquesLista().length <= 1) return; // siempre queda uno
    // Purga las actividades/cantidades/unidades de ese bloque.
    const prefix = `${b}|`;
    this.actividadesSeleccionadas.update((set) => {
      const next = new Set<string>();
      for (const k of set) if (!k.startsWith(prefix)) next.add(k);
      return next;
    });
    const purge = (m: Record<string, unknown>) => {
      const next: Record<string, unknown> = {};
      for (const k of Object.keys(m)) if (!k.startsWith(prefix)) next[k] = m[k];
      return next;
    };
    this.cantidadesActividad.update((m) => purge(m) as Record<string, number | null>);
    this.unidadesActividad.update((m) => purge(m) as Record<string, string | null>);
    this.bloquesLista.update((l) => l.filter((x) => x !== b));
    if (this.bloqueActivo() === b) this.bloqueActivo.set(this.bloquesLista()[0]);
    this.saveDraft();
  }

  // ── Actividades matrix ───────────────────────────────────────
  // Llave con el bloque activo → multi-bloque real.
  private key(estructura: string, actividad: string): string {
    return `${this.bloqueActivo()}|${estructura}|${actividad}`;
  }

  isActividadChecked(estructura: string, actividad: string): boolean {
    return this.actividadesSeleccionadas().has(this.key(estructura, actividad));
  }

  toggleActividad(estructura: string, actividad: string) {
    const k = this.key(estructura, actividad);
    this.actividadesSeleccionadas.update((set) => {
      const next = new Set(set);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
    // Al desmarcar la actividad, olvida su cantidad, unidad y marca de aproximada.
    if (!this.actividadesSeleccionadas().has(k)) {
      this.cantidadesActividad.update((m) => {
        const next = { ...m };
        delete next[k];
        return next;
      });
      this.unidadesActividad.update((m) => {
        const next = { ...m };
        delete next[k];
        return next;
      });
      this.aproximadaActividad.update((m) => {
        const next = { ...m };
        delete next[k];
        return next;
      });
    }
    this.saveDraft();
  }

  // ── AW1 — cantidad aproximada / "se trabajó" sin cantidad exacta ────────────
  /** ¿El catálogo marca esta actividad como difícil de medir (varillas, encofrado…)? */
  permiteSinCantidad(actividad: string): boolean {
    return this.actividadesSinCantidad().has(actividad);
  }

  isAproximada(estructura: string, actividad: string): boolean {
    return this.aproximadaActividad()[this.key(estructura, actividad)] === true;
  }

  /** Alterna el modo "cantidad aproximada (~)" de una línea. */
  toggleAproximada(estructura: string, actividad: string) {
    const k = this.key(estructura, actividad);
    this.aproximadaActividad.update((m) => ({ ...m, [k]: !m[k] }));
    this.saveDraft();
  }

  // R24 — cantidad por actividad.
  setCantidad(estructura: string, actividad: string, n: number) {
    const k = this.key(estructura, actividad);
    this.cantidadesActividad.update((m) => ({ ...m, [k]: n }));
    this.saveDraft();
  }

  getCantidad(estructura: string, actividad: string): number | null {
    return this.cantidadesActividad()[this.key(estructura, actividad)] ?? null;
  }

  // Q6 — unidad de medida por actividad.
  setUnidad(estructura: string, actividad: string, codigo: string) {
    const k = this.key(estructura, actividad);
    this.unidadesActividad.update((m) => ({ ...m, [k]: codigo || null }));
    this.saveDraft();
  }

  getUnidad(estructura: string, actividad: string): string {
    return this.unidadesActividad()[this.key(estructura, actividad)] ?? '';
  }

  // AX6 — agrega un elemento "Otros" (texto libre) como una estructura MÁS de la
  // matriz. Paridad con la app: el usuario luego elige sus actividades y las filas
  // se guardan con `estructura` = el texto tal cual. Dedup contra catálogo + otras.
  agregarEstructuraOtro() {
    const nombre = this.otroNombre().trim();
    if (!nombre) { this.saveError.set('Escribe qué se trabajó ("Otros").'); return; }
    const yaExiste = this.estructurasVista().some((e) => e.toLowerCase() === nombre.toLowerCase());
    if (!yaExiste) this.estructurasOtras.update((l) => [...l, nombre]);
    this.expandedEstructura.set(nombre); // abre el grupo nuevo para elegir actividades
    this.otroNombre.set('');
    this.saveError.set('');
    this.saveDraft();
  }

  // AZ6 — agrega una actividad "Otros" (texto libre) a la estructura y la marca
  // (aparece con su cantidad/unidad, igual que una del catálogo). Paridad con la
  // app; el texto libre alimenta el repositorio "Valores 'Otro'" (trigger de BD).
  agregarActividadOtro(estructura: string) {
    const nombre = this.otroActividadNombre().trim();
    if (!nombre) { this.saveError.set('Escribe qué se hizo ("Otros").'); return; }
    const yaExiste = this.actividadesVista(estructura).some((a) => a.toLowerCase() === nombre.toLowerCase());
    if (!yaExiste) {
      this.actividadesOtras.update((m) => ({ ...m, [estructura]: [...(m[estructura] ?? []), nombre] }));
    }
    // Marca la actividad (si no lo estaba) para que salga con cantidad/unidad.
    if (!this.actividadesSeleccionadas().has(this.key(estructura, nombre))) {
      this.toggleActividad(estructura, nombre);
    }
    this.otroActividadNombre.set('');
    this.saveError.set('');
    this.saveDraft();
  }

  toggleEstructura(estructura: string) {
    this.expandedEstructura.update((cur) => (cur === estructura ? null : estructura));
  }

  isEstructuraExpanded(estructura: string): boolean {
    return this.expandedEstructura() === estructura;
  }

  countForEstructura(estructura: string): number {
    // Scoped al bloque activo (la matriz muestra el bloque en edición).
    const prefix = `${this.bloqueActivo()}|${estructura}|`;
    return [...this.actividadesSeleccionadas()].filter((k) => k.startsWith(prefix)).length;
  }

  /** Total de actividades a través de TODOS los bloques (para el resumen). */
  totalActividades(): number {
    return this.actividadesSeleccionadas().size;
  }

  // ── Restricciones ────────────────────────────────────────────
  isRestriccionChecked(value: string): boolean {
    return this.restriccionesSeleccionadas().has(value);
  }

  toggleRestriccion(value: string) {
    this.restriccionesSeleccionadas.update((set) => {
      if (value === 'NINGUNA') {
        return set.has('NINGUNA') ? new Set() : new Set(['NINGUNA']);
      }
      const next = new Set(set);
      next.delete('NINGUNA');
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
    // U12 — al quitar una restricción, descartar su descripción.
    if (!this.restriccionesSeleccionadas().has(value)) {
      this.restriccionDescripciones.update((m) => {
        const { [value]: _omit, ...rest } = m;
        return rest;
      });
    }
    this.saveDraft();
  }

  // ── Archivos ─────────────────────────────────────────────────
  /** R6 — archivos añadidos desde el componente app-file-upload. */
  onFilesAdded(files: File[]) {
    this.archivos.update((list) => [...list, ...files].slice(0, this.maxArchivos));
  }

  removeArchivo(index: number) {
    this.archivos.update((list) => list.filter((_, i) => i !== index));
  }

  // ── Equipos alquilados (W2 + S7) ─────────────────────────────
  addEquipo() {
    this.equiposAlquilados.update((list) => [
      ...list,
      { equipo: '', uso: '', proveedor: '', para_retirar: false, danado: false, dano_detalle: '' },
    ]);
    this.saveDraft();
  }

  removeEquipo(index: number) {
    this.equiposAlquilados.update((list) => list.filter((_, i) => i !== index));
    this.saveDraft();
  }

  updateEquipo(index: number, field: 'equipo' | 'uso' | 'proveedor' | 'dano_detalle', value: string) {
    this.equiposAlquilados.update((list) =>
      list.map((e, i) => (i === index ? { ...e, [field]: value } : e)),
    );
    this.saveDraft();
  }

  /** S7 — flags de retiro/daño por equipo. */
  setEquipoFlag(index: number, field: 'para_retirar' | 'danado', value: boolean) {
    this.equiposAlquilados.update((list) =>
      list.map((e, i) => (i === index ? { ...e, [field]: value } : e)),
    );
    this.saveDraft();
  }

  /** Al prender "Sí", asegura al menos un renglón; al apagar, limpia la lista. */
  onHuboEquiposChange(hay: boolean) {
    if (hay && this.equiposAlquilados().length === 0) this.addEquipo();
    if (!hay) this.equiposAlquilados.set([]);
    this.saveDraft();
  }

  // ── BP4 — Daños de material / equipo propio ──────────────────────────────────
  addDano() {
    this.danos.update((list) => [
      ...list,
      { tipo: 'material', articulo_id: null, esOtro: false, nombre: '', cantidad: null, unidad: '', detalle: '', solicita_retiro: false, fotos: [] },
    ]);
    this.saveDraft();
  }

  removeDano(index: number) {
    this.danos.update((list) => list.filter((_, i) => i !== index));
    this.saveDraft();
  }

  updateDano(index: number, field: 'nombre' | 'unidad' | 'detalle', value: string) {
    this.danos.update((list) => list.map((d, i) => (i === index ? { ...d, [field]: value } : d)));
    this.saveDraft();
  }

  setDanoTipo(index: number, tipo: 'material' | 'equipo_propio') {
    this.danos.update((list) =>
      list.map((d, i) =>
        i === index
          ? {
              ...d,
              tipo,
              solicita_retiro: tipo === 'material' ? d.solicita_retiro : false,
              // El equipo propio no tiene catálogo: se escribe libre.
              articulo_id: tipo === 'material' ? d.articulo_id : null,
              esOtro: tipo === 'material' ? d.esOtro : false,
            }
          : d,
      ),
    );
    this.saveDraft();
  }

  /**
   * BP4 — selección del picker de artículos para el material dañado. Si eligió un
   * artículo del catálogo, guardamos su id y autollenamos nombre/unidad; si eligió
   * "Otro (escribir)", pasamos a texto libre conservando lo ya tecleado.
   */
  onDanoArticulo(index: number, sel: ArticuloPickerSelection) {
    const art = sel.articuloId ? this.articulosCat().find((a) => a.id === sel.articuloId) : undefined;
    this.danos.update((list) =>
      list.map((d, i) =>
        i === index
          ? {
              ...d,
              articulo_id: sel.articuloId ?? null,
              esOtro: sel.esOtro,
              nombre: sel.esOtro ? d.nombre : art?.nombre ?? '',
              unidad: art?.unidad ?? d.unidad,
            }
          : d,
      ),
    );
    this.saveDraft();
  }

  setDanoCantidad(index: number, value: number | null) {
    const v = value != null && !Number.isNaN(value) ? value : null;
    this.danos.update((list) => list.map((d, i) => (i === index ? { ...d, cantidad: v } : d)));
    this.saveDraft();
  }

  setDanoRetiro(index: number, value: boolean) {
    this.danos.update((list) => list.map((d, i) => (i === index ? { ...d, solicita_retiro: value } : d)));
    this.saveDraft();
  }

  addDanoFotos(index: number, files: File[]) {
    this.danos.update((list) =>
      list.map((d, i) => (i === index ? { ...d, fotos: [...d.fotos, ...files].slice(0, 6) } : d)),
    );
  }

  removeDanoFoto(index: number, fotoIndex: number) {
    this.danos.update((list) =>
      list.map((d, i) => (i === index ? { ...d, fotos: d.fotos.filter((_, n) => n !== fotoIndex) } : d)),
    );
  }

  // ── BO9 — Moldes del día ─────────────────────────────────────────────────────
  addMolde() {
    this.moldes.update((list) => [
      ...list,
      { estructura: '', identificador: '', forma: 'rectangular', tramos: [nuevoMoldeTramo('A')], notas: '', fotos: [] },
    ]);
    this.saveDraft();
  }

  removeMolde(index: number) {
    this.moldes.update((list) => list.filter((_, i) => i !== index));
    this.saveDraft();
  }

  // ── BQ8c — modo Compositor (lienzo de figuras) ────────────────────────────
  setMoldeModo(modo: 'ficha' | 'compositor') {
    this.moldeModo.set(modo);
    this.saveDraft();
  }

  private static readonly FORMA_DE_TIPO: Record<string, MoldeRow['forma']> = {
    rect: 'rectangular', L: 'L', T: 'T', U: 'U', circle: 'circular',
  };

  /** Una figura del compositor = un molde de un tramo (geometría + real/plano). */
  private figuraToMoldeRow(f: CompositorFigura): MoldeRow {
    return {
      estructura: '',
      identificador: `Figura ${f.id}`,
      forma: Nueva.FORMA_DE_TIPO[f.tipo] ?? 'rectangular',
      tramos: [
        {
          lado: 'A',
          largo_cm: f.largo_cm ?? null,
          alto_cm: f.alto_cm ?? null,
          espesor_cm: f.espesor_cm ?? null,
          plano_largo_cm: f.plano_largo_cm ?? null,
          plano_alto_cm: f.plano_alto_cm ?? null,
          plano_espesor_cm: f.plano_espesor_cm ?? null,
        },
      ],
      notas: '',
      fotos: [],
      desdeCompositor: true,
    };
  }

  /** El compositor emitió su lista: sincroniza las filas del compositor en `moldes`,
   *  conservando las que se agregaron por la ficha. */
  onCompositorCambio(figuras: CompositorFigura[]) {
    this.compositorFiguras.set(figuras);
    const fichaRows = this.moldes().filter((m) => !m.desdeCompositor);
    const figRows = figuras.map((f) => this.figuraToMoldeRow(f));
    this.moldes.set([...figRows, ...fichaRows]);
    this.saveDraft();
  }

  updateMoldeText(index: number, field: 'estructura' | 'identificador' | 'notas', value: string) {
    this.moldes.update((list) => list.map((m, i) => (i === index ? { ...m, [field]: value } : m)));
    this.saveDraft();
  }

  /** Las formas L/T/U (y libre) admiten varios lados; rectangular/circular, uno solo. */
  moldeMultiTramo(m: MoldeRow): boolean {
    return m.forma === 'L' || m.forma === 'T' || m.forma === 'U' || m.forma === 'libre';
  }

  setMoldeForma(index: number, forma: MoldeRow['forma']) {
    const single = forma === 'rectangular' || forma === 'circular';
    this.moldes.update((list) =>
      list.map((m, i) => (i === index ? { ...m, forma, tramos: single ? m.tramos.slice(0, 1) : m.tramos } : m)),
    );
    this.saveDraft();
  }

  /** Agrega un lado (B, C…) a un molde compuesto, hasta el tope. */
  addMoldeLado(index: number) {
    this.moldes.update((list) =>
      list.map((m, i) => {
        if (i !== index || m.tramos.length >= MOLDE_MAX_TRAMOS) return m;
        const lado = MOLDE_LADOS[m.tramos.length] ?? String(m.tramos.length + 1);
        return { ...m, tramos: [...m.tramos, nuevoMoldeTramo(lado)] };
      }),
    );
    this.saveDraft();
  }

  /** Quita un lado (mínimo uno) y re-etiqueta A/B/C. */
  removeMoldeLado(index: number, tramoIndex: number) {
    this.moldes.update((list) =>
      list.map((m, i) => {
        if (i !== index || m.tramos.length <= 1) return m;
        const tramos = m.tramos
          .filter((_, n) => n !== tramoIndex)
          .map((t, n) => ({ ...t, lado: MOLDE_LADOS[n] ?? String(n + 1) }));
        return { ...m, tramos };
      }),
    );
    this.saveDraft();
  }

  setMoldeNum(index: number, tramoIndex: number, field: 'largo_cm' | 'alto_cm' | 'espesor_cm' | 'plano_largo_cm' | 'plano_alto_cm' | 'plano_espesor_cm', value: number) {
    const v = value != null && !Number.isNaN(value) ? value : null;
    this.moldes.update((list) =>
      list.map((m, i) =>
        i === index ? { ...m, tramos: m.tramos.map((t, n) => (n === tramoIndex ? { ...t, [field]: v } : t)) } : m,
      ),
    );
    this.saveDraft();
  }

  addMoldeFotos(index: number, files: File[]) {
    this.moldes.update((list) => list.map((m, i) => (i === index ? { ...m, fotos: [...m.fotos, ...files].slice(0, 6) } : m)));
  }
  removeMoldeFoto(index: number, fotoIndex: number) {
    this.moldes.update((list) => list.map((m, i) => (i === index ? { ...m, fotos: m.fotos.filter((_, n) => n !== fotoIndex) } : m)));
  }

  /** Tramos (medida real) para el esquema SVG. */
  moldeTramos(m: MoldeRow) {
    return m.tramos.map((t) => ({ lado: t.lado, largo_cm: t.largo_cm, alto_cm: t.alto_cm, espesor_cm: t.espesor_cm }));
  }
  /** Medida de plano por tramo para el esquema, o null si no se capturó ninguna. */
  moldePlano(m: MoldeRow) {
    const hayPlano = m.tramos.some(
      (t) => t.plano_largo_cm != null || t.plano_alto_cm != null || t.plano_espesor_cm != null,
    );
    if (!hayPlano) return null;
    return m.tramos.map((t) => ({ lado: t.lado, largo_cm: t.plano_largo_cm, alto_cm: t.plano_alto_cm, espesor_cm: t.plano_espesor_cm }));
  }

  /** BO9 — normaliza un molde de un borrador (soporta el formato legacy de un solo
   * tramo con campos planos largo_cm/plano_*). */
  private normalizarMoldeDraft(m: MoldeDraft): MoldeRow {
    const raw = m as unknown as Record<string, unknown>;
    const num = (v: unknown): number | null => (typeof v === 'number' && !Number.isNaN(v) ? v : null);
    const tramosRaw = raw['tramos'];
    const tramos: MoldeTramoForm[] =
      Array.isArray(tramosRaw) && tramosRaw.length
        ? (tramosRaw as Record<string, unknown>[]).map((t, n) => ({
            lado: (typeof t?.['lado'] === 'string' ? (t['lado'] as string) : MOLDE_LADOS[n]) ?? String(n + 1),
            largo_cm: num(t?.['largo_cm']), alto_cm: num(t?.['alto_cm']), espesor_cm: num(t?.['espesor_cm']),
            plano_largo_cm: num(t?.['plano_largo_cm']), plano_alto_cm: num(t?.['plano_alto_cm']), plano_espesor_cm: num(t?.['plano_espesor_cm']),
          }))
        : [{
            lado: 'A',
            largo_cm: num(raw['largo_cm']), alto_cm: num(raw['alto_cm']), espesor_cm: num(raw['espesor_cm']),
            plano_largo_cm: num(raw['plano_largo_cm']), plano_alto_cm: num(raw['plano_alto_cm']), plano_espesor_cm: num(raw['plano_espesor_cm']),
          }];
    return {
      estructura: typeof raw['estructura'] === 'string' ? (raw['estructura'] as string) : '',
      identificador: typeof raw['identificador'] === 'string' ? (raw['identificador'] as string) : '',
      forma: (raw['forma'] as MoldeRow['forma']) ?? 'rectangular',
      tramos,
      notas: typeof raw['notas'] === 'string' ? (raw['notas'] as string) : '',
      fotos: [],
      desdeCompositor: raw['desdeCompositor'] === true, // BQ8c — conserva el origen al retomar el borrador
    };
  }

  // ── Submit ───────────────────────────────────────────────────
  async onSubmit() {
    this.form.markAllAsTouched();
    if (this.form.invalid || this.saving()) return;

    const tipo = this.tipoActual();
    // Z4 — parte "No se trabajó en obra": solo exige obra + fecha + motivo.
    const sinAct = tipo === 'parte_diario' && this.form.controls.sin_actividad.value;
    if (sinAct && !this.form.controls.motivo_sin_actividad.value) {
      this.saveError.set('Indica el motivo de por qué no se trabajó en obra.');
      return;
    }

    if (!sinAct && tipo === 'parte_diario' && this.restriccionesSeleccionadas().size === 0) {
      this.saveError.set('Selecciona al menos una restricción ("Ninguna" si no hubo ninguna).');
      return;
    }

    // U12 — cada restricción seleccionada (menos "Ninguna") exige una descripción.
    if (!sinAct && tipo === 'parte_diario') {
      const faltan = this.restriccionesADescribir().filter(
        (r) => !this.getRestriccionDescripcion(r).trim(),
      );
      if (faltan.length > 0) {
        this.saveError.set(
          `Describe brevemente: ${faltan.map((r) => this.restriccionLabel(r)).join(', ')}.`,
        );
        return;
      }
    }

    // Un "accidente" es, por definición, con lesionados: exige al menos 1.
    if (tipo === 'incidente' && this.form.controls.incidente_tipo.value === 'accidente') {
      if ((this.form.controls.incidente_lesionados.value ?? 0) <= 0) {
        this.saveError.set('Un accidente implica lesionados: indica cuántos (mínimo 1) o cambia el tipo a "Incidente".');
        return;
      }
    }

    // W2 — si marcó "Sí hay equipos alquilados", exige al menos uno con nombre.
    if (!sinAct && tipo === 'parte_diario' && this.form.controls.hubo_equipos.value) {
      const conNombre = this.equiposAlquilados().filter((e) => e.equipo.trim());
      if (conNombre.length === 0) {
        this.saveError.set('Indica al menos un equipo alquilado (o cambia la respuesta a "No").');
        return;
      }
      // S7 — si un equipo está dañado, exige el detalle del daño.
      const danadoSinDetalle = this.equiposAlquilados().find(
        (e) => e.equipo.trim() && e.danado && !e.dano_detalle.trim(),
      );
      if (danadoSinDetalle) {
        this.saveError.set(`Describe el daño de "${danadoSinDetalle.equipo.trim()}".`);
        return;
      }
    }

    // S13 — si el suceso es "Otro", exige el texto libre.
    if (tipo === 'incidente' && this.form.controls.incidente_suceso.value === SUCESO_OTRO) {
      if (!this.form.controls.incidente_suceso_otro.value?.trim()) {
        this.saveError.set('Describe el suceso ("Otro").');
        return;
      }
    }

    // S6 — mínimo de fotos (parte diario ≥2, incidente ≥1). Z4 — el parte "sin
    // actividad" no exige fotos mínimas.
    const nfotos = this.archivos().length;
    if (!sinAct && tipo === 'parte_diario' && nfotos < MIN_FOTOS_PARTE) {
      this.saveError.set(`Agrega al menos ${MIN_FOTOS_PARTE} fotos del trabajo realizado.`);
      return;
    }
    if (tipo === 'incidente' && nfotos < MIN_FOTOS_INCIDENTE) {
      this.saveError.set(`Agrega al menos ${MIN_FOTOS_INCIDENTE} foto del incidente.`);
      return;
    }

    this.saving.set(true);
    this.saveError.set('');

    const v = this.form.getRawValue();
    const esParte = tipo === 'parte_diario';
    // T3 — paridad con la app: multi-bloque REAL. Cada actividad lleva su propio
    // bloque; si el usuario no lo especifica, hereda el bloque de cabecera
    // (que actúa como valor por defecto). El RPC ya lee `bloque` por actividad.
    const bloqueParte = esParte ? (v.bloque_entrepiso?.trim() || null) : null;
    const actividades = esParte && !sinAct
      ? [...this.actividadesSeleccionadas()].map((k) => {
          // X13 — llave `bloque|estructura|actividad`.
          const [bloque, estructura, actividad] = k.split('|') as [string, string, string];
          return {
            estructura,
            actividad,
            cantidad: this.cantidadesActividad()[k] ?? null,
            unidad: this.unidadesActividad()[k] ?? null,
            // 'General' sin bloque de cabecera ⇒ hereda el de cabecera (o queda null).
            bloque: bloque === 'General' ? bloqueParte : bloque,
            // AW1 — cantidad marcada como aproximada (~) por el usuario.
            es_aproximada: this.aproximadaActividad()[k] === true,
          };
        })
      : [];
    // AX6 — los "Otros" ya NO se anexan aparte: son estructuras de la matriz
    // (estructurasOtras) y sus filas salen del bucle de arriba con `estructura` =
    // el texto libre tal cual (paridad con la app; feed del catálogo).
    const restricciones = esParte && !sinAct
      ? [...this.restriccionesSeleccionadas()].map((r) => ({
          tipo_restriccion: r,
          // U12 — descripción por restricción (null para "Ninguna").
          descripcion_otro: r === 'NINGUNA' ? null : (this.getRestriccionDescripcion(r).trim() || null),
        }))
      : [];

    try {
      const usuarioId = this.userService.profile()?.id;
      if (!usuarioId) throw new Error('Sesión inválida. Vuelve a iniciar sesión.');

      // Auto-capture the weather at the obra when the project has coordinates,
      // so every entry carries its climate context with no manual input.
      let weatherSnapshotId: string | null = null;
      const proyecto = this.proyectos().find((p) => p.id === v.proyecto_id);
      if (proyecto?.latitud != null && proyecto.longitud != null) {
        try {
          const coords = { latitud: proyecto.latitud, longitud: proyecto.longitud };
          const ctx = await this.contextService.getContexto(coords);
          weatherSnapshotId = await this.weatherService.guardarSnapshot(coords, ctx.pronostico.actual, proyecto.id);
        } catch {
          // Weather capture is best-effort; never block saving the bitácora.
        }
      }

      const created = await this.bitacoraService.create({
        usuario_id: usuarioId,
        proyecto_id: v.proyecto_id!,
        fecha: v.fecha!,
        tipo,
        comentarios: v.comentarios ?? null,
        bloque_entrepiso: esParte ? v.bloque_entrepiso! : null,
        ingeniero_responsable: esParte ? v.ingeniero_responsable! : null,
        hora_fin_trabajo: esParte ? v.hora_fin_trabajo! : null,
        personal_carpinteria: esParte ? v.personal_carpinteria! : 0,
        personal_acero: esParte ? v.personal_acero! : 0,
        trabajadores_casa: esParte ? v.trabajadores_casa! : 0,
        otro_personal: esParte ? (v.otro_personal ?? null) : null,
        actividades,
        restricciones,
        visita_tipo_visitante: tipo === 'visita' ? (v.visita_tipo_visitante ?? null) : null,
        visita_nombre: tipo === 'visita' ? (v.visita_nombre ?? null) : null,
        visita_organizacion: tipo === 'visita' ? (v.visita_organizacion ?? null) : null,
        visita_motivo: tipo === 'visita' ? (v.visita_motivo ?? null) : null,
        incidente_tipo: tipo === 'incidente' ? (v.incidente_tipo ?? null) : null,
        incidente_gravedad: tipo === 'incidente' ? (v.incidente_gravedad ?? null) : null,
        incidente_subcontratista: tipo === 'incidente' ? (v.incidente_subcontratista ?? null) : null,
        incidente_lesionados: tipo === 'incidente' ? (v.incidente_lesionados ?? 0) : 0,
        incidente_descripcion: tipo === 'incidente' ? (v.incidente_descripcion ?? null) : null,
        incidente_acciones: tipo === 'incidente' ? (v.incidente_acciones ?? null) : null,
        // S12/S13 — incidente de equipo + suceso probable.
        incidente_equipo_nombre:
          v.incidente_tipo === 'incidente_equipo' ? (v.incidente_equipo_nombre?.trim() || null) : null,
        incidente_equipo_alquilado:
          v.incidente_tipo === 'incidente_equipo' && v.incidente_equipo_alquilado
            ? v.incidente_equipo_alquilado === 'alquilado'
            : null,
        incidente_equipo_operativo:
          v.incidente_tipo === 'incidente_equipo' && v.incidente_equipo_operativo
            ? v.incidente_equipo_operativo === 'si'
            : null,
        // T19 — comentario de operatividad (se guarda solo para incidente de equipo).
        incidente_equipo_operativo_comentario:
          v.incidente_tipo === 'incidente_equipo'
            ? (v.incidente_equipo_operativo_comentario?.trim() || null)
            : null,
        incidente_suceso:
          tipo === 'incidente'
            ? v.incidente_suceso === SUCESO_OTRO
              ? (v.incidente_suceso_otro?.trim() || null)
              : (v.incidente_suceso || null)
            : null,
        weather_snapshot_id: weatherSnapshotId,
        // Z4 — día reportado sin trabajo en obra (solo parte diario).
        sin_actividad: sinAct,
        motivo_sin_actividad: sinAct ? (v.motivo_sin_actividad ?? null) : null,
        motivo_sin_actividad_detalle:
          sinAct && v.motivo_sin_actividad === 'otro' ? (v.motivo_sin_actividad_detalle?.trim() || null) : null,
        // Clima + migración (R21/R22) — solo aplican al parte diario.
        llovio: esParte ? !!v.llovio : null,
        lluvia_detalle: esParte && v.llovio ? (v.lluvia_detalle || null) : null,
        // Z5 — horas de lluvia (0..24), solo si llovió.
        horas_lluvia: esParte && v.llovio ? (v.horas_lluvia ?? null) : null,
        hubo_migracion: esParte ? !!v.hubo_migracion : null,
        migracion_obreros:
          esParte && v.hubo_migracion && v.migracion_obreros_texto?.trim()
            ? v.migracion_obreros_texto
                .split('\n')
                .map((s) => s.trim())
                .filter(Boolean)
            : null,
        // Equipos alquilados (W2) — solo parte diario.
        hubo_equipos: esParte ? !!v.hubo_equipos : null,
        equipos_alquilados:
          esParte && v.hubo_equipos
            ? this.equiposAlquilados()
                .filter((e) => e.equipo.trim())
                .map((e) => ({
                  equipo: e.equipo.trim(),
                  uso: e.uso.trim() || null,
                  proveedor: e.proveedor.trim() || null,
                  para_retirar: e.para_retirar,
                  danado: e.danado,
                  dano_detalle: e.danado ? (e.dano_detalle.trim() || null) : null,
                }))
            : [],
      });

      for (const file of this.archivos()) {
        try {
          await this.bitacoraService.subirArchivo(created.id, file);
        } catch (e: unknown) {
          console.error('Error subiendo archivo:', file.name, e);
        }
      }

      // BP4 — daños de material / equipo propio (solo parte diario). Sube las fotos
      // de cada daño y llama al escritor hijo; un daño de material con "solicitar
      // retiro" crea la solicitud BG4 y la enlaza (aparece en /inventario/retiros).
      // Material: vale si tiene artículo del catálogo o nombre libre. Equipo propio: nombre libre.
      const danosLimpios = esParte
        ? this.danos().filter((d) => (d.articulo_id || d.nombre.trim()) && d.detalle.trim())
        : [];
      const moldesLimpios = esParte ? this.moldes().filter((m) => !!m.tramos[0]?.largo_cm) : [];
      if (danosLimpios.length || moldesLimpios.length) {
        const danosPayload: BitacoraDanoInput[] = [];
        for (const d of danosLimpios) {
          const fotos_paths: string[] = [];
          for (const f of d.fotos) {
            try { fotos_paths.push(await this.bitacoraService.subirFotoDano(created.id, f)); }
            catch (e: unknown) { console.error('Error subiendo foto de daño:', e); }
          }
          // BP4 — material vinculado al catálogo manda articulo_id; si es "Otro" o
          // equipo propio manda nombre_libre (el RPC exige uno de los dos).
          const usaArticulo = d.tipo === 'material' && !!d.articulo_id;
          danosPayload.push({
            tipo: d.tipo,
            articulo_id: usaArticulo ? d.articulo_id : null,
            nombre_libre: usaArticulo ? null : d.nombre.trim() || null,
            cantidad: d.cantidad,
            unidad: d.unidad.trim() || null,
            detalle: d.detalle.trim(),
            fotos_paths,
            solicita_retiro: d.tipo === 'material' ? d.solicita_retiro : false,
          });
        }
        const moldesPayload: BitacoraMoldeInput[] = [];
        for (const m of moldesLimpios) {
          const fotos_paths: string[] = [];
          for (const f of m.fotos) {
            try { fotos_paths.push(await this.bitacoraService.subirFotoDano(created.id, f)); }
            catch (e: unknown) { console.error('Error subiendo foto de molde:', e); }
          }
          moldesPayload.push({
            estructura: m.estructura.trim() || null,
            identificador: m.identificador.trim() || null,
            forma: m.forma,
            tramos: this.moldeTramos(m),
            medida_plano: this.moldePlano(m),
            notas: m.notas.trim() || null,
            fotos_paths,
          });
        }
        try {
          await this.bitacoraService.guardarBitacoraExtra(created.id, { danos: danosPayload, moldes: moldesPayload });
        } catch (e: unknown) {
          // La bitácora ya se guardó; daños/moldes son anexos. No bloqueamos la navegación.
          console.error('Error guardando anexos de la bitácora (daños/moldes):', e);
        }
      }

      // Y15 — enlaza la bitácora a la tarea del cronograma elegida (evidencia) y,
      // si se marcó, completa la tarea usando una foto de esta bitácora.
      const tareaId = this.form.controls.cronograma_tarea_id.value;
      if (tareaId) {
        try {
          await this.cronogramaService.enlazarBitacora(tareaId, created.id, false);
          if (this.form.controls.cronograma_completar.value) {
            const imagen = this.archivos().find((f) => f.type.startsWith('image/'));
            if (imagen) {
              const path = await this.cronogramaService.subirEvidencia(tareaId, imagen);
              // Usa los comentarios como justificación si la tarea está atrasada.
              await this.cronogramaService.completar(tareaId, path, this.f.comentarios.value || null);
            }
          }
        } catch (e: unknown) {
          console.error('Error enlazando/completando tarea de cronograma:', e);
        }
      }

      // X13 — al enviar con éxito, quita el borrador en proceso.
      this.borradores.remove(this.MODULO_BORRADOR, this.draftId);
      this.router.navigate(['/bitacora/historial']);
    } catch (e: unknown) {
      // BC7/AU5(d) — nunca mostrar el error crudo de Postgres. El borrador (texto
      // + fotos en las señales del formulario) sobrevive: NO se limpia ni se navega.
      const friendly = humanizeError(e);
      if (friendly.technical) {
        // "ya fue reportado": deja traza para Tecnología (best-effort).
        this.reportarFalloGuardado(friendly.raw);
        this.saveError.set('No pudimos guardar la bitácora. Ya fue reportado y lo estamos revisando — tus datos y fotos siguen aquí, puedes reintentar.');
      } else {
        this.saveError.set(friendly.mensaje);
      }
    } finally {
      this.saving.set(false);
    }
  }

  /** BC7 — reporta a Tecnología un fallo técnico al guardar la bitácora (best-effort). */
  private reportarFalloGuardado(raw: string): void {
    const usuarioId = this.userService.profile()?.id;
    if (!usuarioId) return;
    this.reportes
      .crear({
        usuario_id: usuarioId,
        tipo: 'bug',
        asunto: 'No se pudo guardar una bitácora',
        descripcion: `Error técnico al guardar bitácora (crear_entrada_bitacora): ${raw}`.slice(0, 1000),
      })
      .catch(() => {
        /* el reporte es best-effort; no debe tapar el mensaje al usuario */
      });
  }

  /** Y15 — carga las tareas no completadas del cronograma del proyecto elegido. */
  /** Z14 — carga las estructuras (bloques/pisos) de la obra para el selector. */
  private async loadEstructuras(proyectoId: string | null) {
    if (!proyectoId) {
      this.estructurasObra.set([]);
      return;
    }
    try {
      this.estructurasObra.set(await this.estructurasService.getNombres(proyectoId));
    } catch {
      this.estructurasObra.set([]);
    }
  }

  private async loadTareasCronograma(proyectoId: string | null) {
    this.form.controls.cronograma_tarea_id.setValue(null, { emitEvent: false });
    if (!proyectoId) {
      this.tareasCronograma.set([]);
      return;
    }
    try {
      const data = await this.cronogramaService.listar(proyectoId);
      this.tareasCronograma.set(
        data.tareas
          .filter((t) => t.estado !== 'completada')
          .map((t) => ({ id: t.id, nombre: t.nombre })),
      );
    } catch {
      this.tareasCronograma.set([]);
    }
  }

  get f() {
    return this.form.controls;
  }
}
