import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { QaService, QaCaseInput } from '../../../../shared/services/qa.service';
import { ToastService } from '../../../../shared/services/toast.service';
import {
  QaTestCase,
  QaTestRun,
  QaTestRunResult,
  QaResultado,
  QaPlataforma,
  QA_MODULOS,
  QA_PRIORIDADES,
  QA_PLATAFORMAS,
  QA_RESULTADOS,
  qaPrioridadLabel,
  qaPlataformaLabel,
  qaResultadoLabel,
  qaEstadoLabel,
  qaResultadoBadge,
  qaPrioridadBadge,
  qaRunEstadoBadge,
} from '../../../../shared/models/qa.model';
import { formatFechaDisplay } from '../../../../shared/utils/fecha.util';
import { FormDrawer } from '../../../../shared/components/form-drawer/form-drawer';
import { Skeleton } from '../../../../shared/components/skeleton/skeleton';
import { Icon } from '../../../../shared/ui/icon/icon';

type QaTab = 'casos' | 'nueva' | 'ejecutar' | 'historial';

@Component({
  selector: 'app-tec-qa',
  imports: [ReactiveFormsModule, FormDrawer, Skeleton, Icon],
  templateUrl: './qa.html',
  styleUrl: './qa.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TecQa implements OnInit {
  private qa = inject(QaService);
  private toast = inject(ToastService);

  readonly MODULOS = QA_MODULOS;
  readonly PRIORIDADES = QA_PRIORIDADES;
  readonly PLATAFORMAS = QA_PLATAFORMAS;
  readonly RESULTADOS = QA_RESULTADOS;
  readonly ESTADOS_EJEC: QaResultado[] = ['passed', 'failed', 'blocked', 'skipped'];

  prioridadLabel = qaPrioridadLabel;
  plataformaLabel = qaPlataformaLabel;
  resultadoLabel = qaResultadoLabel;
  estadoLabel = qaEstadoLabel;
  resultadoBadge = qaResultadoBadge;
  prioridadBadge = qaPrioridadBadge;
  runEstadoBadge = qaRunEstadoBadge;
  formatFecha = formatFechaDisplay;

  tab = signal<QaTab>('casos');
  loading = signal(false);
  error = signal('');

  // ── Casos ──────────────────────────────────────────────────────────────
  casos = signal<QaTestCase[]>([]);
  fModulo = signal('');
  fPlataforma = signal<QaPlataforma | ''>('');
  fPrioridad = signal('');
  fActivo = signal<'' | 'si' | 'no'>('');

  casosFiltrados = computed(() => {
    const mod = this.fModulo();
    const plat = this.fPlataforma();
    const prio = this.fPrioridad();
    const act = this.fActivo();
    return this.casos().filter((c) => {
      if (mod && c.modulo !== mod) return false;
      if (plat && c.plataforma !== plat) return false;
      if (prio && c.prioridad !== prio) return false;
      if (act === 'si' && !c.activo) return false;
      if (act === 'no' && c.activo) return false;
      return true;
    });
  });

  /** Casos filtrados agrupados por módulo (para el listado). */
  casosPorModulo = computed(() => {
    const groups = new Map<string, QaTestCase[]>();
    for (const c of this.casosFiltrados()) {
      const list = groups.get(c.modulo) ?? [];
      list.push(c);
      groups.set(c.modulo, list);
    }
    return [...groups.entries()].map(([modulo, items]) => ({ modulo, items }));
  });

  hasCaseFilters = computed(
    () => !!(this.fModulo() || this.fPlataforma() || this.fPrioridad() || this.fActivo()),
  );

  // ── Drawer de caso (CRUD) ──
  drawerOpen = signal(false);
  editingId = signal<string | null>(null);
  saving = signal(false);

  form = new FormGroup({
    modulo: new FormControl<string>('general', [Validators.required]),
    titulo: new FormControl('', [Validators.required, Validators.maxLength(200)]),
    precondiciones: new FormControl<string | null>(null),
    pasos: new FormControl<string | null>(null),
    resultado_esperado: new FormControl<string | null>(null),
    prioridad: new FormControl<string>('media', [Validators.required]),
    plataforma: new FormControl<string>('ambas', [Validators.required]),
    activo: new FormControl<boolean>(true, { nonNullable: true }),
    orden: new FormControl<number | null>(null),
  });

  // ── Nueva corrida ──────────────────────────────────────────────────────
  nuevaPlataforma = signal<QaPlataforma>('web');
  nuevaVersion = signal('');
  nuevaTitulo = signal('');
  selModulo = signal('');
  seleccionados = signal<Set<string>>(new Set());
  creando = signal(false);

  /** Casos activos elegibles para la corrida (según plataforma + filtro módulo). */
  casosElegibles = computed(() => {
    const plat = this.nuevaPlataforma();
    const mod = this.selModulo();
    return this.casos().filter((c) => {
      if (!c.activo) return false;
      // Un caso 'ambas' aplica a cualquier plataforma; si no, debe coincidir.
      if (c.plataforma !== 'ambas' && c.plataforma !== plat) return false;
      if (mod && c.modulo !== mod) return false;
      return true;
    });
  });

  seleccionadosCount = computed(() => this.seleccionados().size);
  todosElegiblesSeleccionados = computed(() => {
    const elig = this.casosElegibles();
    if (elig.length === 0) return false;
    const sel = this.seleccionados();
    return elig.every((c) => sel.has(c.id));
  });

  // ── Ejecutar corrida ─────────────────────────────────────────────────────
  activeRun = signal<QaTestRun | null>(null);
  resultados = signal<QaTestRunResult[]>([]);
  notasDraft = signal<Record<string, string>>({});
  evidenciaUrls = signal<Record<string, string>>({});
  subiendo = signal<string | null>(null);

  conteos = computed(() => {
    const acc: Record<QaResultado, number> = {
      pendiente: 0,
      passed: 0,
      failed: 0,
      blocked: 0,
      skipped: 0,
    };
    for (const r of this.resultados()) acc[r.resultado]++;
    return acc;
  });

  /** % pass sobre los casos evaluados (passed+failed+blocked); skipped/pendiente no cuentan. */
  passPct = computed(() => {
    const c = this.conteos();
    const evaluados = c.passed + c.failed + c.blocked;
    return evaluados === 0 ? 0 : Math.round((c.passed / evaluados) * 100);
  });
  progresoPct = computed(() => {
    const total = this.resultados().length;
    if (total === 0) return 0;
    return Math.round(((total - this.conteos().pendiente) / total) * 100);
  });

  // ── Historial ────────────────────────────────────────────────────────────
  runs = signal<QaTestRun[]>([]);
  runResumenPct = signal<Record<string, number>>({});

  /** % pass de una corrida en el historial (0 si aún no se calculó). */
  pctDe(runId: string): number {
    return this.runResumenPct()[runId] ?? 0;
  }

  ngOnInit() {
    void this.loadCasos();
  }

  cambiarTab(t: QaTab) {
    if (this.tab() === t) return;
    this.tab.set(t);
    this.error.set('');
    if (t === 'casos' && this.casos().length === 0) void this.loadCasos();
    if (t === 'nueva' && this.casos().length === 0) void this.loadCasos();
    if (t === 'historial') void this.loadRuns();
  }

  // ── Casos: carga y CRUD ───────────────────────────────────────────────
  async loadCasos() {
    this.loading.set(true);
    this.error.set('');
    try {
      this.casos.set(await this.qa.getCases());
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'Error al cargar los casos.');
    } finally {
      this.loading.set(false);
    }
  }

  clearCaseFilters() {
    this.fModulo.set('');
    this.fPlataforma.set('');
    this.fPrioridad.set('');
    this.fActivo.set('');
  }

  nuevoCaso() {
    this.editingId.set(null);
    this.form.reset({
      modulo: 'general',
      titulo: '',
      precondiciones: null,
      pasos: null,
      resultado_esperado: null,
      prioridad: 'media',
      plataforma: 'ambas',
      activo: true,
      orden: null,
    });
    this.drawerOpen.set(true);
  }

  editarCaso(c: QaTestCase) {
    this.editingId.set(c.id);
    this.form.reset({
      modulo: c.modulo,
      titulo: c.titulo,
      precondiciones: c.precondiciones,
      pasos: c.pasos,
      resultado_esperado: c.resultado_esperado,
      prioridad: c.prioridad,
      plataforma: c.plataforma,
      activo: c.activo,
      orden: c.orden,
    });
    this.drawerOpen.set(true);
  }

  cerrarDrawer() {
    this.drawerOpen.set(false);
  }

  async guardarCaso() {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.saving.set(true);
    try {
      const v = this.form.getRawValue();
      const input: QaCaseInput = {
        modulo: v.modulo!,
        titulo: v.titulo!.trim(),
        precondiciones: v.precondiciones?.trim() || null,
        pasos: v.pasos?.trim() || null,
        resultado_esperado: v.resultado_esperado?.trim() || null,
        prioridad: v.prioridad as QaCaseInput['prioridad'],
        plataforma: v.plataforma as QaPlataforma,
        activo: v.activo,
        orden: v.orden ?? null,
      };
      const id = this.editingId();
      if (id) {
        await this.qa.updateCase(id, input);
        this.toast.success('Caso actualizado.');
      } else {
        await this.qa.createCase(input);
        this.toast.success('Caso creado.');
      }
      this.drawerOpen.set(false);
      await this.loadCasos();
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo guardar el caso.');
    } finally {
      this.saving.set(false);
    }
  }

  async toggleActivo(c: QaTestCase) {
    try {
      await this.qa.toggleActivo(c.id, !c.activo);
      this.casos.update((list) =>
        list.map((x) => (x.id === c.id ? { ...x, activo: !c.activo } : x)),
      );
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo cambiar el estado.');
    }
  }

  // ── Nueva corrida ──────────────────────────────────────────────────────
  onNuevaPlataforma(plat: QaPlataforma) {
    this.nuevaPlataforma.set(plat);
    this.seleccionados.set(new Set());
  }

  toggleSeleccion(id: string) {
    this.seleccionados.update((set) => {
      const next = new Set(set);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  toggleTodos() {
    const elig = this.casosElegibles();
    this.seleccionados.update((set) => {
      const next = new Set(set);
      const allSelected = elig.every((c) => next.has(c.id));
      if (allSelected) {
        for (const c of elig) next.delete(c.id);
      } else {
        for (const c of elig) next.add(c.id);
      }
      return next;
    });
  }

  async crearCorrida() {
    const ids = [...this.seleccionados()];
    if (ids.length === 0) {
      this.toast.warning('Selecciona al menos un caso.');
      return;
    }
    this.creando.set(true);
    try {
      const runId = await this.qa.crearCorrida(
        this.nuevaPlataforma(),
        this.nuevaVersion().trim(),
        this.nuevaTitulo().trim(),
        ids,
      );
      this.toast.success('Corrida creada.');
      // Reset del formulario de nueva corrida.
      this.nuevaVersion.set('');
      this.nuevaTitulo.set('');
      this.selModulo.set('');
      this.seleccionados.set(new Set());
      await this.abrirCorrida(runId);
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo crear la corrida.');
    } finally {
      this.creando.set(false);
    }
  }

  // ── Ejecutar corrida ─────────────────────────────────────────────────────
  async abrirCorrida(runId: string) {
    this.tab.set('ejecutar');
    this.loading.set(true);
    this.error.set('');
    try {
      const { run, resultados } = await this.qa.getRun(runId);
      this.activeRun.set(run);
      this.resultados.set(resultados);
      const draft: Record<string, string> = {};
      for (const r of resultados) draft[r.id] = r.notas ?? '';
      this.notasDraft.set(draft);
      await this.cargarEvidencias(resultados);
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'No se pudo abrir la corrida.');
    } finally {
      this.loading.set(false);
    }
  }

  private async cargarEvidencias(resultados: QaTestRunResult[]) {
    const urls: Record<string, string> = {};
    await Promise.all(
      resultados
        .filter((r) => r.evidencia_path)
        .map(async (r) => {
          urls[r.id] = await this.qa.getEvidenciaUrl(r.evidencia_path);
        }),
    );
    this.evidenciaUrls.set(urls);
  }

  private replaceResultado(updated: QaTestRunResult) {
    this.resultados.update((list) => list.map((r) => (r.id === updated.id ? updated : r)));
  }

  onNotasInput(id: string, value: string) {
    this.notasDraft.update((d) => ({ ...d, [id]: value }));
  }

  async setEstado(r: QaTestRunResult, estado: QaResultado) {
    if (this.corridaCerrada()) return;
    try {
      const updated = await this.qa.setResultado(r.id, {
        resultado: estado,
        notas: this.notasDraft()[r.id] ?? null,
      });
      this.replaceResultado(updated);
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo guardar el resultado.');
    }
  }

  async guardarNotas(r: QaTestRunResult) {
    if (this.corridaCerrada()) return;
    const notas = this.notasDraft()[r.id] ?? '';
    if ((r.notas ?? '') === notas) return;
    try {
      const updated = await this.qa.setResultado(r.id, { notas: notas || null });
      this.replaceResultado(updated);
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudieron guardar las notas.');
    }
  }

  async onEvidencia(r: QaTestRunResult, event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const run = this.activeRun();
    if (!run) return;
    this.subiendo.set(r.id);
    try {
      const path = await this.qa.uploadEvidencia(run.id, file);
      const updated = await this.qa.setResultado(r.id, { evidencia_path: path });
      this.replaceResultado(updated);
      const url = await this.qa.getEvidenciaUrl(path);
      this.evidenciaUrls.update((m) => ({ ...m, [r.id]: url }));
      this.toast.success('Evidencia subida.');
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo subir la evidencia.');
    } finally {
      this.subiendo.set(null);
      input.value = '';
    }
  }

  /** Crea un reporte de error prellenado con el caso y lo enlaza al resultado. */
  async crearReporte(r: QaTestRunResult) {
    const run = this.activeRun();
    try {
      const reporteId = await this.qa.crearReporteError({
        titulo: r.caso_titulo,
        modulo: r.modulo,
        notas: this.notasDraft()[r.id] ?? r.notas,
        versionObjetivo: run?.version_objetivo,
        runId: run?.id,
      });
      const updated = await this.qa.setResultado(r.id, { error_report_id: reporteId });
      this.replaceResultado(updated);
      this.toast.success('Reporte de error creado y enlazado.');
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo crear el reporte.');
    }
  }

  /** Enlaza un reporte de error ya existente por su id (UUID). */
  async enlazarReporte(r: QaTestRunResult) {
    const id = prompt('Pega el ID (UUID) del reporte de error a enlazar:')?.trim();
    if (!id) return;
    try {
      const updated = await this.qa.setResultado(r.id, { error_report_id: id });
      this.replaceResultado(updated);
      this.toast.success('Reporte enlazado.');
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo enlazar el reporte.');
    }
  }

  corridaCerrada = computed(() => this.activeRun()?.estado !== 'en_progreso');

  async completar() {
    const run = this.activeRun();
    if (!run) return;
    if (this.conteos().pendiente > 0) {
      if (!confirm(`Quedan ${this.conteos().pendiente} casos pendientes. ¿Marcar la corrida como completada de todos modos?`))
        return;
    }
    try {
      await this.qa.completarCorrida(run.id);
      this.activeRun.set({ ...run, estado: 'completada' });
      this.toast.success('Corrida marcada como completada.');
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo completar la corrida.');
    }
  }

  // ── Historial ────────────────────────────────────────────────────────────
  async loadRuns() {
    this.loading.set(true);
    this.error.set('');
    try {
      const runs = await this.qa.getRuns();
      this.runs.set(runs);
      // % pass por corrida (carga ligera en paralelo).
      const pct: Record<string, number> = {};
      await Promise.all(
        runs.map(async (run) => {
          const res = await this.qa.getResultados(run.id);
          const passed = res.filter((r) => r.resultado === 'passed').length;
          const evaluados = res.filter((r) =>
            ['passed', 'failed', 'blocked'].includes(r.resultado),
          ).length;
          pct[run.id] = evaluados === 0 ? 0 : Math.round((passed / evaluados) * 100);
        }),
      );
      this.runResumenPct.set(pct);
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'Error al cargar el historial.');
    } finally {
      this.loading.set(false);
    }
  }
}
