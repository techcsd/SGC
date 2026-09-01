import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { HumanizarEnumPipe } from '../../../../shared/pipes/humanizar-enum.pipe';
import { DecimalPipe } from '@angular/common';
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
import { Icon } from '../../../../shared/ui/icon/icon';
import { todayIso, formatFechaDisplay } from '../../../../shared/utils/fecha.util';

/** AA24 — conector real de una dependencia (predecesora → esta tarea). */
interface DepConn {
  left: number;   // px
  width: number;  // px
  forward: boolean;
  tipo: DependenciaTipo;
  lag: number;
  titulo: string;
}

interface GanttBar {
  tarea: CronogramaTarea;
  planLeft: number;   // px
  planWidth: number;  // px
  realLeft: number;   // px
  realWidth: number;  // px
  avancePct: number;      // AV2 — avance real reportado (0–100) para el relleno
  avanceEsperadoPct: number; // AV2 — avance esperado por calendario (marca en la barra)
  atrasada: boolean;
  tooltip: string;    // AV2 — responsable/volumetría/rendimiento/fechas
  // AA24 — conectores de dependencias REALES (una por predecesora).
  deps: DepConn[];
}

/** AV2 — un grupo de barras (por fase/torre) para el Gantt agrupado. */
interface GanttGrupo {
  titulo: string;
  bars: GanttBar[];
}

interface EjeTick {
  left: number;  // px
  label: string;
  fuerte: boolean; // marca de mes/semana destacada
}

const MS_DAY = 86400000;

// AV2 — zoom del Gantt: px por día según la escala elegida.
type GanttZoom = 'dia' | 'semana' | 'mes';
const ZOOM_PX: Record<GanttZoom, number> = { dia: 44, semana: 16, mes: 5 };
const GANTT_LABEL_W = 220;

@Component({
  selector: 'app-proyecto-cronograma',
  imports: [HumanizarEnumPipe, ReactiveFormsModule, RouterLink, DecimalPipe, Icon],
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

  // AV2 — zoom del Gantt (día/semana/mes) → px por día.
  readonly LABEL_W = GANTT_LABEL_W;
  zoom = signal<GanttZoom>('semana');
  pxPorDia = computed(() => ZOOM_PX[this.zoom()]);
  setZoom(z: GanttZoom) { this.zoom.set(z); }

  /** Ancho total (px) de la zona de barras según el zoom. */
  chartWidth = computed(() => {
    const r = this.rango();
    if (!r) return 0;
    return Math.max(320, Math.round(r.span * this.pxPorDia()));
  });

  ganttBars = computed<GanttBar[]>(() => {
    const ts = this.tareas();
    const r = this.rango();
    if (!r) return [];
    const { min } = r;
    const ppd = this.pxPorDia();
    const px = (ms: number) => ((ms - min) / MS_DAY) * ppd;
    const today = this.parse(this.hoy);

    // AA24 — dependencias REALES (predecesora → sucesora) indexadas por sucesora.
    const tareaById = new Map(ts.map((t) => [t.id, t] as const));
    const nombreCorto = (n: string) => (n.length > 24 ? n.slice(0, 22) + '…' : n);

    return ts.map((t) => {
      const pi = t.fecha_inicio_plan ? this.parse(t.fecha_inicio_plan) : min;
      const pf = t.fecha_fin_plan ? this.parse(t.fecha_fin_plan) : pi;
      const ri = t.fecha_inicio_real ? this.parse(t.fecha_inicio_real) : null;
      const rf = t.fecha_fin_real ? this.parse(t.fecha_fin_real) : ri;

      // AV2 — avance real (Excel/manual) y avance esperado por calendario.
      const avancePct = Math.max(0, Math.min(100,
        t.avance_pct ?? (t.estado === 'completada' ? 100 : 0)));
      const spanDias = Math.max(1, (pf - pi) / MS_DAY + 1);
      const avanceEsperadoPct = t.estado === 'completada' ? 100
        : Math.max(0, Math.min(100, ((today - pi) / MS_DAY / spanDias) * 100));

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
        if (d.tipo === 'SS') { fromX = px(pIni); toX = px(sIni); }
        else if (d.tipo === 'FF') { fromX = px(pFin); toX = px(sFin); }
        else { fromX = px(pFin); toX = px(sIni); } // FS
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

      // AV2 — tooltip enriquecido con la data del cronograma importado.
      const partes = [
        `Plan: ${this.formatFecha(t.fecha_inicio_plan)} → ${this.formatFecha(t.fecha_fin_plan)}`,
        `Avance: ${Math.round(avancePct)}% (esperado ${Math.round(avanceEsperadoPct)}%)`,
      ];
      if (t.responsable) partes.push(`Responsable: ${t.responsable}`);
      if (t.volumetria) partes.push(`Volumetría: ${t.volumetria}`);
      if (t.rendimiento) partes.push(`Rendimiento: ${t.rendimiento}`);

      return {
        tarea: t,
        planLeft: px(pi),
        planWidth: Math.max(6, ((pf - pi) / MS_DAY + 1) * ppd),
        realLeft: ri !== null ? px(ri) : 0,
        realWidth: ri !== null ? Math.max(6, (((rf ?? ri) - ri) / MS_DAY + 1) * ppd) : 0,
        avancePct,
        avanceEsperadoPct,
        atrasada: esTareaAtrasada(t, this.hoy),
        tooltip: partes.join('\n'),
        deps,
      };
    });
  });

  /** AV2 — agrupa las barras por fase/torre (o `grupo` importado). Una sola si no hay. */
  ganttGrupos = computed<GanttGrupo[]>(() => {
    const bars = this.ganttBars();
    const map = new Map<string, GanttBar[]>();
    for (const b of bars) {
      const key = this.faseNombre(b.tarea.fase_id) || b.tarea.grupo || 'General';
      (map.get(key) ?? map.set(key, []).get(key)!).push(b);
    }
    // Si solo hay un grupo "General", no vale la pena mostrar cabeceras.
    if (map.size === 1 && map.has('General')) return [{ titulo: '', bars: map.get('General')! }];
    return Array.from(map, ([titulo, gbars]) => ({ titulo, bars: gbars }));
  });

  /** AV2 — eje temporal en px: marcas según el zoom (día/semana/mes). */
  ejeTicks = computed<EjeTick[]>(() => {
    const r = this.rango();
    if (!r) return [];
    const { min, max } = r;
    const ppd = this.pxPorDia();
    const z = this.zoom();
    const stepDias = z === 'dia' ? 1 : z === 'semana' ? 7 : 30;
    const ticks: EjeTick[] = [];
    // Alinea el primer tick al inicio del rango; una marca cada stepDias.
    for (let ms = min, i = 0; ms <= max; ms += stepDias * MS_DAY, i++) {
      const d = new Date(ms);
      ticks.push({
        left: ((ms - min) / MS_DAY) * ppd,
        label: this.tickLabel(ms),
        fuerte: z === 'dia' ? d.getUTCDay() === 1 : d.getUTCDate() <= stepDias,
      });
    }
    return ticks;
  });

  private tickLabel(ms: number): string {
    const d = new Date(ms);
    const dia = d.getUTCDate();
    const mes = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'][d.getUTCMonth()];
    return this.zoom() === 'mes' ? `${mes} ${String(d.getUTCFullYear()).slice(2)}` : `${dia} ${mes}`;
  }

  todayPx = computed(() => {
    const r = this.rango();
    if (!r) return null;
    const { min, max } = r;
    const today = this.parse(this.hoy);
    if (today < min || today > max) return null;
    return ((today - min) / MS_DAY) * this.pxPorDia();
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
