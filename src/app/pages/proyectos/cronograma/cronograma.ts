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
  CRONOGRAMA_TIPOS,
  CRONOGRAMA_MOTIVOS,
  esTareaAtrasada,
} from '../../../../shared/models/cronograma.model';
import { FaseProyecto } from '../../../../shared/models/proyecto.model';
import { todayIso, formatFechaDisplay } from '../../../../shared/utils/fecha.util';

interface GanttBar {
  tarea: CronogramaTarea;
  planLeft: number;
  planWidth: number;
  realLeft: number;
  realWidth: number;
  atrasada: boolean;
  // Z16 — conector de dependencia finish-to-start con la tarea anterior (encadenada).
  tieneDep: boolean;
  depLeft: number;
  depWidth: number;
  /** El inicio de esta tarea es posterior al fin de la anterior (dependencia sana). */
  depForward: boolean;
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
  formatFecha = formatFechaDisplay;

  proyectoId = signal('');
  proyectoNombre = signal('');
  catalogoTareas = signal<string[]>([]);  // Z15
  fases = signal<FaseProyecto[]>([]);      // Y15 — contenedores (fases) del proyecto
  highlightTarea = signal<string | null>(null);

  tareas = signal<CronogramaTarea[]>([]);
  recalculos = signal<CronogramaRecalculo[]>([]);
  loading = signal(true);
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

    // Encadenamiento por `orden`: cada tarea depende de la anterior (finish-to-start).
    const ordenadas = [...ts].sort((a, b) => a.orden - b.orden);
    const idxById = new Map(ordenadas.map((t, i) => [t.id, i] as const));

    return ts.map((t) => {
      const pi = t.fecha_inicio_plan ? this.parse(t.fecha_inicio_plan) : min;
      const pf = t.fecha_fin_plan ? this.parse(t.fecha_fin_plan) : pi;
      const ri = t.fecha_inicio_real ? this.parse(t.fecha_inicio_real) : null;
      const rf = t.fecha_fin_real ? this.parse(t.fecha_fin_real) : ri;

      // Dependencia con la tarea anterior en el orden (si ambas tienen plan).
      const myIdx = idxById.get(t.id) ?? 0;
      const prev = myIdx > 0 ? ordenadas[myIdx - 1] : null;
      let tieneDep = false, depLeft = 0, depWidth = 0, depForward = true;
      if (prev && prev.fecha_fin_plan && t.fecha_inicio_plan) {
        const prevFin = pct(this.parse(prev.fecha_fin_plan) + MS_DAY); // fin de día
        const curIni = pct(pi);
        tieneDep = true;
        depForward = curIni >= prevFin - 0.01;
        depLeft = Math.min(prevFin, curIni);
        depWidth = Math.max(0, Math.abs(curIni - prevFin));
      }

      return {
        tarea: t,
        planLeft: pct(pi),
        planWidth: Math.max(2, ((pf - pi) / MS_DAY + 1) / span * 100),
        realLeft: ri !== null ? pct(ri) : 0,
        realWidth: ri !== null ? Math.max(2, (((rf ?? ri) - ri) / MS_DAY + 1) / span * 100) : 0,
        atrasada: esTareaAtrasada(t, this.hoy),
        tieneDep, depLeft, depWidth, depForward,
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
