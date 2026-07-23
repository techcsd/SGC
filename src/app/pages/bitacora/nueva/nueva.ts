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
import { Router } from '@angular/router';
import { BitacoraService } from '../../../../shared/services/bitacora.service';
import { ProyectosService } from '../../../../shared/services/proyectos.service';
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
} from '../../../../shared/models/bitacora.model';
import { todayIso } from '../../../../shared/utils/fecha.util';
import { QtyStepper } from '../../../../shared/ui/qty-stepper/qty-stepper';
import { Skeleton } from '../../../../shared/components/skeleton/skeleton';
import { FileUpload } from '../../../../shared/ui/file-upload/file-upload';

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
}

@Component({
  selector: 'app-bitacora-nueva',
  imports: [ReactiveFormsModule, QtyStepper, Skeleton, FileUpload],
  templateUrl: './nueva.html',
  styleUrl: './nueva.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Nueva implements OnInit {
  private bitacoraService = inject(BitacoraService);
  private proyectosService = inject(ProyectosService);
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

  // Default to the built-in lists, then override with the admin-managed catalog.
  estructuras = signal<readonly string[]>(ESTRUCTURAS);
  actividades = signal<readonly string[]>(ACTIVIDADES);
  // Q6 — catálogo de unidades de medida (activas) para el trabajo realizado.
  unidades = signal<Unidad[]>([]);
  restricciones = signal<{ value: string; label: string }[]>(RESTRICCIONES);
  readonly TIPOS = BITACORA_TIPOS;
  readonly VISITANTE_TIPOS = VISITANTE_TIPOS;
  readonly INCIDENTE_TIPOS = INCIDENTE_TIPOS;
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

  // X13 — multi-bloque REAL (paridad app): la actividad se captura por el BLOQUE
  // activo. Llave = `bloque|estructura|actividad`, así la misma actividad puede
  // registrarse en dos bloques distintos en el mismo parte.
  actividadesSeleccionadas = signal<Set<string>>(new Set());
  cantidadesActividad = signal<Record<string, number | null>>({});
  unidadesActividad = signal<Record<string, string | null>>({});
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
    descripcion_otro_restriccion: new FormControl<string | null>(null),
    // Clima + migración (R21/R22) — parte diario. La lluvia NO es un incidente.
    llovio: new FormControl<boolean>(false, { nonNullable: true }),
    lluvia_detalle: new FormControl<string | null>(null, [Validators.maxLength(1000)]),
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

  activeProyectos = computed(() => this.proyectos().filter((p) => p.activo));
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
  }

  /** S2 — trae el catálogo con ranking de uso de la obra elegida (best-effort). */
  private async aplicarRanking(proyectoId: string | null) {
    if (!proyectoId) return;
    try {
      const cat = await this.catalogosService.getCatalogosOrdenados(proyectoId);
      if (cat.estructuras.length) this.estructuras.set(cat.estructuras);
      if (cat.actividades.length) this.actividades.set(cat.actividades);
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
    return !!(v.proyecto_id || this.actividadesSeleccionadas().size || this.restriccionesSeleccionadas().size
      || v.comentarios || v.incidente_descripcion || this.equiposAlquilados().length);
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
    // Al desmarcar la actividad, olvida su cantidad y unidad.
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
    }
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

  // ── Submit ───────────────────────────────────────────────────
  async onSubmit() {
    this.form.markAllAsTouched();
    if (this.form.invalid || this.saving()) return;

    const tipo = this.tipoActual();

    if (tipo === 'parte_diario' && this.restriccionesSeleccionadas().size === 0) {
      this.saveError.set('Selecciona al menos una restricción ("Ninguna" si no hubo ninguna).');
      return;
    }

    // U12 — cada restricción seleccionada (menos "Ninguna") exige una descripción.
    if (tipo === 'parte_diario') {
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
    if (tipo === 'parte_diario' && this.form.controls.hubo_equipos.value) {
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

    // S6 — mínimo de fotos (parte diario ≥2, incidente ≥1).
    const nfotos = this.archivos().length;
    if (tipo === 'parte_diario' && nfotos < MIN_FOTOS_PARTE) {
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
    const actividades = esParte
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
          };
        })
      : [];
    const restricciones = esParte
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
        // Clima + migración (R21/R22) — solo aplican al parte diario.
        llovio: esParte ? !!v.llovio : null,
        lluvia_detalle: esParte && v.llovio ? (v.lluvia_detalle || null) : null,
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

      // X13 — al enviar con éxito, quita el borrador en proceso.
      this.borradores.remove(this.MODULO_BORRADOR, this.draftId);
      this.router.navigate(['/bitacora/historial']);
    } catch (e: unknown) {
      this.saveError.set(e instanceof Error ? e.message : 'Error al guardar la bitácora.');
    } finally {
      this.saving.set(false);
    }
  }

  get f() {
    return this.form.controls;
  }
}
