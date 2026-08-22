import { Component, ChangeDetectionStrategy, inject, signal, computed, OnInit } from '@angular/core';
import { HumanizarEnumPipe } from '../../../../shared/pipes/humanizar-enum.pipe';
import { DecimalPipe } from '@angular/common';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ObraProduccionService } from '../../../../shared/services/obra-produccion.service';
import { ProyectosService } from '../../../../shared/services/proyectos.service';
import { ToastService } from '../../../../shared/services/toast.service';
import { UserService } from '../../../core/services/user.service';
import { Proyecto } from '../../../../shared/models/proyecto.model';
import {
  AvanceActual, AvanceSnapshot, CronogramaTareaAvance, ManoObra, PruebaCampo,
  CostoMaterial, OCProgramada, ReportePerdida,
} from '../../../../shared/models/obra-produccion.model';
import { todayIso, formatFechaDisplay } from '../../../../shared/utils/fecha.util';
import { FormDrawer } from '../../../../shared/components/form-drawer/form-drawer';
import { Skeleton } from '../../../../shared/components/skeleton/skeleton';

type Tab = 'avance' | 'costos' | 'logistica';

@Component({
  selector: 'app-obra-avance',
  imports: [HumanizarEnumPipe, ReactiveFormsModule, DecimalPipe, FormDrawer, Skeleton],
  templateUrl: './avance.html',
  styleUrl: './avance.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ObraAvance implements OnInit {
  private service = inject(ObraProduccionService);
  private proyectosService = inject(ProyectosService);
  private userService = inject(UserService);
  private toast = inject(ToastService);

  formatFecha = formatFechaDisplay;

  tab = signal<Tab>('avance');
  loadingInit = signal(true);
  loading = signal(false);
  saving = signal(false);

  proyectos = signal<Proyecto[]>([]);
  proyectoId = signal<string>('');

  avance = signal<AvanceActual>({ avance_plan_pct: 0, avance_real_pct: 0 });
  snapshots = signal<AvanceSnapshot[]>([]);
  tareas = signal<CronogramaTareaAvance[]>([]);

  costo = signal<CostoMaterial | null>(null);
  costoError = signal('');
  manoObra = signal<ManoObra[]>([]);
  perdidas = signal<ReportePerdida[]>([]);

  ocProgramadas = signal<OCProgramada[]>([]);
  pruebas = signal<PruebaCampo[]>([]);

  puedeOperar = computed(() => this.userService.puedeOperarSubmodulo('obra.avance'));

  totalHorasHombre = computed(() => this.manoObra().reduce((a, m) => a + (m.horas_hombre ?? 0), 0));
  desviacion = computed(() => Math.round((this.avance().avance_real_pct - this.avance().avance_plan_pct) * 10) / 10);

  // ── Curva-S (SVG polyline) ──
  readonly CHART_W = 640;
  readonly CHART_H = 180;
  private puntos(sel: (s: AvanceSnapshot) => number | null) {
    const snaps = this.snapshots();
    if (snaps.length < 2) return '';
    const n = snaps.length;
    return snaps
      .map((s, i) => {
        const x = (i / (n - 1)) * this.CHART_W;
        const y = this.CHART_H - ((sel(s) ?? 0) / 100) * this.CHART_H;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  }
  lineaPlan = computed(() => this.puntos((s) => s.avance_plan_pct));
  lineaReal = computed(() => this.puntos((s) => s.avance_real_pct));
  hayCurva = computed(() => this.snapshots().length >= 2);

  manoObraForm = new FormGroup({
    fecha: new FormControl<string>(todayIso(), [Validators.required]),
    actividad: new FormControl<string | null>(null),
    cantidad_trabajadores: new FormControl<number>(0, [Validators.required, Validators.min(0)]),
    horas: new FormControl<number>(8, [Validators.required, Validators.min(0)]),
    notas: new FormControl<string | null>(null),
  });
  manoObraOpen = signal(false);

  pruebaForm = new FormGroup({
    tipo: new FormControl<string>('slump', [Validators.required]),
    fecha: new FormControl<string>(todayIso(), [Validators.required]),
    resultado: new FormControl<string | null>(null),
    notas: new FormControl<string | null>(null),
  });
  pruebaOpen = signal(false);

  async ngOnInit() {
    try {
      const proyectos = await this.proyectosService.getAll();
      this.proyectos.set(proyectos);
      if (proyectos.length) {
        this.proyectoId.set(proyectos[0].id);
        await this.loadAll();
      }
    } catch (e: unknown) {
      this.toast.error('Error al cargar', e instanceof Error ? e.message : undefined);
    } finally {
      this.loadingInit.set(false);
    }
  }

  async onProyectoChange(id: string) {
    this.proyectoId.set(id);
    await this.loadAll();
  }

  async loadAll() {
    if (!this.proyectoId()) return;
    const pid = this.proyectoId();
    this.loading.set(true);
    this.costoError.set('');
    try {
      const [avance, snaps, tareas, manoObra, oc, pruebas, perdidas] = await Promise.all([
        this.service.getAvanceActual(pid),
        this.service.getAvanceSnapshots(pid),
        this.service.getCronogramaTareas(pid),
        this.service.getManoObra(pid),
        this.service.getOCProgramadas(pid),
        this.service.getPruebasCampo(pid),
        this.service.getReportesPerdidas(pid),
      ]);
      this.avance.set(avance);
      this.snapshots.set(snaps);
      this.tareas.set(tareas);
      this.manoObra.set(manoObra);
      this.ocProgramadas.set(oc);
      this.pruebas.set(pruebas);
      this.perdidas.set(perdidas);
      // Costo aparte: puede fallar por permiso (capataz).
      try { this.costo.set(await this.service.getCostoMaterial(pid)); }
      catch (e: unknown) { this.costo.set(null); this.costoError.set(e instanceof Error ? e.message : 'Sin permiso'); }
    } catch (e: unknown) {
      this.toast.error('Error al cargar', e instanceof Error ? e.message : undefined);
    } finally {
      this.loading.set(false);
    }
  }

  setTab(t: Tab) { this.tab.set(t); }

  async capturarBaseline() {
    if (!this.puedeOperar()) return;
    try {
      const n = await this.service.capturarBaseline(this.proyectoId());
      this.toast.success('Línea base congelada', `${n} tarea(s)`);
      await this.loadAll();
    } catch (e: unknown) {
      this.toast.error('Error', e instanceof Error ? e.message : undefined);
    }
  }

  async cambiarAvanceTarea(t: CronogramaTareaAvance, valor: string) {
    const n = Math.max(0, Math.min(100, Number(valor) || 0));
    try {
      await this.service.reportarAvanceTarea(t.id, n);
      this.tareas.update((l) => l.map((x) => (x.id === t.id ? { ...x, avance_pct: n } : x)));
      this.avance.set(await this.service.getAvanceActual(this.proyectoId()));
    } catch (e: unknown) {
      this.toast.error('Error', e instanceof Error ? e.message : undefined);
    }
  }

  // ── Mano de obra ──
  openManoObra() { this.manoObraForm.reset({ fecha: todayIso(), cantidad_trabajadores: 0, horas: 8 }); this.manoObraOpen.set(true); }
  async saveManoObra() {
    this.manoObraForm.markAllAsTouched();
    if (this.manoObraForm.invalid || this.saving()) return;
    this.saving.set(true);
    try {
      const v = this.manoObraForm.value;
      await this.service.registrarManoObra({
        proyectoId: this.proyectoId(),
        fecha: v.fecha!,
        actividad: v.actividad || null,
        cantidadTrabajadores: v.cantidad_trabajadores ?? 0,
        horas: v.horas ?? 0,
        notas: v.notas || null,
      });
      this.toast.success('Parte de mano de obra registrado');
      this.manoObraOpen.set(false);
      this.manoObra.set(await this.service.getManoObra(this.proyectoId()));
    } catch (e: unknown) {
      this.toast.error('Error', e instanceof Error ? e.message : undefined);
    } finally {
      this.saving.set(false);
    }
  }

  // ── Prueba de campo ──
  openPrueba() { this.pruebaForm.reset({ tipo: 'slump', fecha: todayIso() }); this.pruebaOpen.set(true); }
  async savePrueba() {
    this.pruebaForm.markAllAsTouched();
    if (this.pruebaForm.invalid || this.saving()) return;
    this.saving.set(true);
    try {
      const v = this.pruebaForm.value;
      await this.service.registrarPruebaCampo({
        proyectoId: this.proyectoId(),
        tipo: v.tipo!,
        fecha: v.fecha!,
        resultado: v.resultado || null,
        notas: v.notas || null,
        fotos: [],
      });
      this.toast.success('Prueba de campo registrada');
      this.pruebaOpen.set(false);
      this.pruebas.set(await this.service.getPruebasCampo(this.proyectoId()));
    } catch (e: unknown) {
      this.toast.error('Error', e instanceof Error ? e.message : undefined);
    } finally {
      this.saving.set(false);
    }
  }

  estadoBadge(estado: string): string {
    switch (estado) {
      case 'completada': return 'sgc-badge sgc-badge--success';
      case 'en_curso': return 'sgc-badge sgc-badge--info';
      default: return 'sgc-badge sgc-badge--neutral';
    }
  }

  get fM() { return this.manoObraForm.controls; }
  get fP() { return this.pruebaForm.controls; }
}
