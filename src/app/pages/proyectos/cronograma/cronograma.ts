import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { CronogramaService } from '../../../../shared/services/cronograma.service';
import { ProyectosService } from '../../../../shared/services/proyectos.service';
import { UserService } from '../../../core/services/user.service';
import { ToastService } from '../../../../shared/services/toast.service';
import {
  CronogramaTarea,
  CronogramaRecalculo,
  CronogramaTipo,
  CronogramaDependencia,
  DependenciaTipo,
  CRONOGRAMA_TIPOS,
  CRONOGRAMA_MOTIVOS,
  DEPENDENCIA_TIPOS,
  esTareaAtrasada,
} from '../../../../shared/models/cronograma.model';
import { FaseProyecto } from '../../../../shared/models/proyecto.model';
import { todayIso, formatFechaDisplay } from '../../../../shared/utils/fecha.util';

/** AA24 — conector real de una dependencia (predecesora → esta tarea). */
interface DepConn {
  left: number;
  width: number;
  forward: boolean;
  tipo: DependenciaTipo;
  lag: number;
  titulo: string;
}

interface GanttBar {
  tarea: CronogramaTarea;
  planLeft: number;
  planWidth: number;
  realLeft: number;
  realWidth: number;
  atrasada: boolean;
  // AA24 — conectores de dependencias REALES (una por predecesora).
  deps: DepConn[];
}

interface EjeTick {
  pct: number;
  label: string;
}

const MS_DAY = 86400000;

@Component({
  selector: 'app-proyecto-cronograma',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './cronograma.html',
  styleUrl: './cronograma.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Cronograma implements OnInit {
  private route = inject(ActivatedRoute);
  private service = inject(CronogramaService);
  private proyectosService = inject(ProyectosService);
  private userService = inject(UserService);
  private toast = inject(ToastService);

  readonly tipos = CRONOGRAMA_TIPOS;
  readonly motivos = CRONOGRAMA_MOTIVOS;
  readonly depTipos = DEPENDENCIA_TIPOS;
  formatFecha = formatFechaDisplay;

  proyectoId = signal('');
  proyectoNombre = signal('');
  catalogoTareas = signal<string[]>([]);  // Z15
  fases = signal<FaseProyecto[]>([]);      // Y15 — contenedores (fases) del proyecto
  highlightTarea = signal<string | null>(null);

  tareas = signal<CronogramaTarea[]>([]);
  recalculos = signal<CronogramaRecalculo[]>([]);
  dependencias = signal<CronogramaDependencia[]>([]); // AA24
  loading = signal(true);

  // AA24 — editor de predecesoras (en el panel de editar tarea).
  nuevaDepPredecesora = signal<string | null>(null);
  nuevaDepTipo = signal<DependenciaTipo>('FS');
  nuevaDepLag = signal(0);
  guardandoDep = signal(false);
  error = signal('');
  vista = signal<'gantt' | 'lista'>('gantt');

  puedeGestionar = computed(
    () => this.userService.hasRole('admin') || this.userService.hasModulo('proyectos'),
  );
  hoy = todayIso();

  // ── Form: nueva/editar tarea ──
  editandoId = signal<string | null>(null);
  panelTareaAbierto = signal(false);
  tareaForm = new FormGroup({
    nombre: new FormControl('', [Validators.required, Validators.maxLength(200)]),
    tipo: new FormControl<CronogramaTipo>('ordinaria', [Validators.required]),
    duracion_dias_plan: new FormControl(1, [Validators.required, Validators.min(1)]),
    fase_id: new FormControl<string | null>(null),  // Y15 — contenedor (fase) opcional
    descripcion: new FormControl(''),
    fecha_inicio_plan: new FormControl<string | null>(null),
  });

  // ── Y15 — Justificar retraso (independiente de completar) ──
  justificandoId = signal<string | null>(null);
  justificacionTexto = signal('');

  // ── Completar ──
  completandoId = signal<string | null>(null);
  completarFile: File | null = null;
  completarJustificacion = signal('');
  guardando = signal(false);

  progreso = computed(() => {
    const ts = this.tareas();
    if (!ts.length) return 0;
    const done = ts.filter((t) => t.estado === 'completada').length;
    return Math.round((done / ts.length) * 100);
  });

  // ── Gantt geometry ──
  /** Rango temporal común (min/max/span en días) de todo el cronograma. */
  private rango = computed<{ min: number; max: number; span: number } | null>(() => {
    const ts = this.tareas();
    const dates: number[] = [];
    for (const t of ts) {
      for (const d of [t.fecha_inicio_plan, t.fecha_fin_plan, t.fecha_inicio_real, t.fecha_fin_real]) {
        if (d) dates.push(this.parse(d));
      }
    }
    if (!dates.length) return null;
    const min = Math.min(...dates);
    const max = Math.max(...dates);
    return { min, max, span: Math.max(1, (max - min) / MS_DAY + 1) };
  });

  ganttBars = computed<GanttBar[]>(() => {
    const ts = this.tareas();
    const r = this.rango();
    if (!r) return [];
    const { min, span } = r;
    const pct = (ms: number) => ((ms - min) / MS_DAY / span) * 100;

    // AA24 — dependencias REALES (predecesora → sucesora) indexadas por sucesora.
    const tareaById = new Map(ts.map((t) => [t.id, t] as const));
    const nombreCorto = (n: string) => (n.length > 24 ? n.slice(0, 22) + '…' : n);

    return ts.map((t) => {
      const pi = t.fecha_inicio_plan ? this.parse(t.fecha_inicio_plan) : min;
      const pf = t.fecha_fin_plan ? this.parse(t.fecha_fin_plan) : pi;
      const ri = t.fecha_inicio_real ? this.parse(t.fecha_inicio_real) : null;
      const rf = t.fecha_fin_real ? this.parse(t.fecha_fin_real) : ri;

      // Un conector por dependencia real de esta tarea (según su tipo/lag).
      const deps: DepConn[] = [];
      for (const d of this.dependencias()) {
        if (d.sucesora_id !== t.id) continue;
        const p = tareaById.get(d.predecesora_id);
        if (!p || !p.fecha_inicio_plan || !p.fecha_fin_plan || !t.fecha_inicio_plan || !t.fecha_fin_plan) continue;
        const pIni = this.parse(p.fecha_inicio_plan);
        const pFin = this.parse(p.fecha_fin_plan) + MS_DAY; // fin de día
        const sIni = this.parse(t.fecha_inicio_plan);
        const sFin = this.parse(t.fecha_fin_plan) + MS_DAY;
        let fromX: number, toX: number;
        if (d.tipo === 'SS') { fromX = pct(pIni); toX = pct(sIni); }
        else if (d.tipo === 'FF') { fromX = pct(pFin); toX = pct(sFin); }
        else { fromX = pct(pFin); toX = pct(sIni); } // FS
        const lagTxt = d.lag_dias ? ` ${d.lag_dias > 0 ? '+' : ''}${d.lag_dias}d` : '';
        deps.push({
          left: Math.min(fromX, toX),
          width: Math.max(0, Math.abs(toX - fromX)),
          forward: toX >= fromX - 0.01,
          tipo: d.tipo,
          lag: d.lag_dias,
          titulo: `${d.tipo}${lagTxt} · depende de "${nombreCorto(p.nombre)}"`,
        });
      }

      return {
        tarea: t,
        planLeft: pct(pi),
        planWidth: Math.max(2, ((pf - pi) / MS_DAY + 1) / span * 100),
        realLeft: ri !== null ? pct(ri) : 0,
        realWidth: ri !== null ? Math.max(2, (((rf ?? ri) - ri) / MS_DAY + 1) / span * 100) : 0,
        atrasada: esTareaAtrasada(t, this.hoy),
        deps,
      };
    });
  });

  /** Z16 — eje temporal: ~7 marcas equiespaciadas con su fecha. */
  ejeTicks = computed<EjeTick[]>(() => {
    const r = this.rango();
    if (!r) return [];
    const { min, max } = r;
    const totalDias = (max - min) / MS_DAY;
    const n = Math.min(7, Math.max(2, Math.round(totalDias / 7) + 1));
    const ticks: EjeTick[] = [];
    for (let i = 0; i < n; i++) {
      const frac = i / (n - 1);
      const ms = min + (max - min) * frac;
      ticks.push({ pct: frac * 100, label: this.tickLabel(ms) });
    }
    return ticks;
  });

  private tickLabel(ms: number): string {
    const d = new Date(ms);
    const dia = d.getUTCDate();
    const mes = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'][d.getUTCMonth()];
    return `${dia} ${mes}`;
  }

  todayPct = computed(() => {
    const r = this.rango();
    if (!r) return null;
    const { min, max, span } = r;
    const today = this.parse(this.hoy);
    if (today < min || today > max) return null;
    return ((today - min) / MS_DAY / span) * 100;
  });

  private parse(iso: string): number {
    // Parse YYYY-MM-DD at UTC noon to avoid timezone drift in layout math.
    const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
    return Date.UTC(y, m - 1, d, 12);
  }

  ngOnInit() {
    const id = this.route.snapshot.paramMap.get('id') ?? '';
    this.proyectoId.set(id);
    this.highlightTarea.set(this.route.snapshot.queryParamMap.get('tarea'));
    void this.cargarNombre(id);
    void this.cargar();
    void this.service.getCatalogo().then((c) => this.catalogoTareas.set(c));
  }

  private async cargarNombre(id: string) {
    try {
      const p = await this.proyectosService.getById(id);
      this.proyectoNombre.set(p?.nombre ?? '');
      // Y15 — fases del proyecto para el selector de contenedor en el form.
      this.fases.set((p?.fases ?? []).slice().sort((a, b) => a.orden - b.orden));
    } catch {
      /* nombre es cosmético */
    }
  }

  /** Y15 — nombre de la fase (contenedor) de una tarea, para pintarlo en la lista. */
  faseNombre(id: string | null): string {
    if (!id) return '';
    return this.fases().find((f) => f.id === id)?.nombre ?? '';
  }

  async cargar() {
    this.loading.set(true);
    this.error.set('');
    try {
      const data = await this.service.listar(this.proyectoId());
      this.tareas.set(data.tareas);
      this.recalculos.set(data.recalculos);
      this.dependencias.set(data.dependencias ?? []); // AA24
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'Error al cargar el cronograma.');
    } finally {
      this.loading.set(false);
    }
  }

  atrasada(t: CronogramaTarea): boolean {
    return esTareaAtrasada(t, this.hoy);
  }

  tipoLabel(t: string): string {
    return this.tipos.find((x) => x.value === t)?.label ?? t;
  }

  // ── Nueva / editar ──
  abrirNueva() {
    this.editandoId.set(null);
    this.tareaForm.reset({ nombre: '', tipo: 'ordinaria', duracion_dias_plan: 1, fase_id: null, descripcion: '', fecha_inicio_plan: null });
    // La primera tarea puede fijar la fecha de inicio; el resto se encadena.
    this.panelTareaAbierto.set(true);
  }

  abrirEditar(t: CronogramaTarea) {
    this.editandoId.set(t.id);
    this.tareaForm.reset({
      nombre: t.nombre,
      tipo: t.tipo,
      duracion_dias_plan: t.duracion_dias_plan,
      fase_id: t.fase_id,
      descripcion: t.descripcion ?? '',
      fecha_inicio_plan: t.fecha_inicio_plan,
    });
    this.panelTareaAbierto.set(true);
  }

  async guardarTarea() {
    if (this.tareaForm.invalid) {
      this.tareaForm.markAllAsTouched();
      return;
    }
    const v = this.tareaForm.getRawValue();
    this.guardando.set(true);
    try {
      if (this.editandoId()) {
        await this.service.actualizarTarea(this.editandoId()!, this.proyectoId(), {
          nombre: v.nombre!,
          tipo: v.tipo!,
          duracion_dias_plan: v.duracion_dias_plan!,
          fase_id: v.fase_id || null,
          descripcion: v.descripcion || null,
        });
      } else {
        await this.service.crearTarea({
          proyectoId: this.proyectoId(),
          nombre: v.nombre!,
          tipo: v.tipo!,
          duracionDias: v.duracion_dias_plan!,
          faseId: v.fase_id || null,
          descripcion: v.descripcion || null,
          fechaInicioPlan: v.fecha_inicio_plan || null,
        });
      }
      this.panelTareaAbierto.set(false);
      await this.cargar();
      this.toast.success('Tarea guardada.');
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo guardar.');
    } finally {
      this.guardando.set(false);
    }
  }

  // ── AA24 — predecesoras de la tarea en edición ──
  /** Dependencias donde la tarea editada es la sucesora (sus predecesoras). */
  predecesorasDeEditando = computed<{ dep: CronogramaDependencia; pred: CronogramaTarea | undefined }[]>(() => {
    const id = this.editandoId();
    if (!id) return [];
    const byId = new Map(this.tareas().map((t) => [t.id, t] as const));
    return this.dependencias()
      .filter((d) => d.sucesora_id === id)
      .map((dep) => ({ dep, pred: byId.get(dep.predecesora_id) }));
  });

  /** Tareas que se pueden elegir como predecesora (todas menos la editada). El
   *  servidor rechaza duplicados y ciclos, así que no hace falta filtrarlos aquí. */
  tareasComoPredecesora = computed<CronogramaTarea[]>(() => {
    const id = this.editandoId();
    return this.tareas().filter((t) => t.id !== id);
  });

  async agregarDependencia() {
    const sucId = this.editandoId();
    const predId = this.nuevaDepPredecesora();
    if (!sucId || !predId) return;
    this.guardandoDep.set(true);
    try {
      await this.service.crearDependencia(predId, sucId, this.nuevaDepTipo(), this.nuevaDepLag() || 0);
      this.nuevaDepPredecesora.set(null);
      this.nuevaDepTipo.set('FS');
      this.nuevaDepLag.set(0);
      await this.cargar();
      this.toast.success('Dependencia agregada.');
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo agregar la dependencia.');
    } finally {
      this.guardandoDep.set(false);
    }
  }

  async quitarDependencia(depId: string) {
    try {
      await this.service.quitarDependencia(depId);
      await this.cargar();
      this.toast.success('Dependencia eliminada.');
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo quitar la dependencia.');
    }
  }

  depTipoLabel(t: DependenciaTipo): string {
    return this.depTipos.find((x) => x.value === t)?.label ?? t;
  }

  async eliminar(t: CronogramaTarea) {
    if (!confirm(`¿Eliminar la tarea «${t.nombre}»?`)) return;
    try {
      await this.service.eliminarTarea(t.id, this.proyectoId());
      await this.cargar();
      this.toast.success('Tarea eliminada.');
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo eliminar.');
    }
  }

  async iniciar(t: CronogramaTarea) {
    try {
      await this.service.iniciar(t.id);
      await this.cargar();
      this.toast.success('Tarea iniciada.');
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo iniciar.');
    }
  }

  // ── Completar ──
  abrirCompletar(t: CronogramaTarea) {
    this.completandoId.set(t.id);
    this.completarFile = null;
    this.completarJustificacion.set('');
  }

  onFotoSelected(ev: Event) {
    const input = ev.target as HTMLInputElement;
    this.completarFile = input.files?.[0] ?? null;
  }

  requiereJustificacion(t: CronogramaTarea): boolean {
    return this.atrasada(t);
  }

  async confirmarCompletar(t: CronogramaTarea) {
    if (!this.completarFile) {
      this.toast.error('Adjunta una foto de evidencia.');
      return;
    }
    if (this.requiereJustificacion(t) && !this.completarJustificacion().trim()) {
      this.toast.error('La tarea está atrasada: escribe una justificación.');
      return;
    }
    this.guardando.set(true);
    try {
      const path = await this.service.subirEvidencia(t.id, this.completarFile);
      await this.service.completar(t.id, path, this.completarJustificacion().trim() || null);
      this.completandoId.set(null);
      await this.cargar();
      this.toast.success('Tarea completada.');
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo completar.');
    } finally {
      this.guardando.set(false);
    }
  }

  cancelarCompletar() {
    this.completandoId.set(null);
    this.completarFile = null;
  }

  // ── Y15 — Justificar retraso (sin completar la tarea) ──
  abrirJustificar(t: CronogramaTarea) {
    this.justificandoId.set(t.id);
    this.justificacionTexto.set(t.justificacion_retraso ?? '');
  }

  cancelarJustificar() {
    this.justificandoId.set(null);
    this.justificacionTexto.set('');
  }

  async confirmarJustificar(t: CronogramaTarea) {
    const texto = this.justificacionTexto().trim();
    if (!texto) {
      this.toast.error('Escribe la justificación del retraso.');
      return;
    }
    this.guardando.set(true);
    try {
      await this.service.justificarRetraso(t.id, texto);
      this.justificandoId.set(null);
      this.justificacionTexto.set('');
      await this.cargar();
      this.toast.success('Retraso justificado.');
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo justificar.');
    } finally {
      this.guardando.set(false);
    }
  }

  nombreTarea(id: string | null): string {
    if (!id) return '—';
    return this.tareas().find((t) => t.id === id)?.nombre ?? '(eliminada)';
  }

  // ── Bitácoras enlazadas (evidencia) ──
  bitacorasExpandida = signal<string | null>(null);
  bitacorasDeTarea = signal<Record<string, { id: string; fecha: string; tipo: string }[]>>({});

  async toggleBitacoras(t: CronogramaTarea) {
    if (this.bitacorasExpandida() === t.id) {
      this.bitacorasExpandida.set(null);
      return;
    }
    if (!this.bitacorasDeTarea()[t.id]) {
      const bits = await this.service.getBitacorasDeTarea(t.id);
      this.bitacorasDeTarea.update((m) => ({ ...m, [t.id]: bits }));
    }
    this.bitacorasExpandida.set(t.id);
  }
}
