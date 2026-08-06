import { Component, ChangeDetectionStrategy, inject, signal, computed, OnInit } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ObraProduccionService } from '../../../../shared/services/obra-produccion.service';
import { ProyectosService } from '../../../../shared/services/proyectos.service';
import { ToastService } from '../../../../shared/services/toast.service';
import { UserService } from '../../../core/services/user.service';
import { Proyecto } from '../../../../shared/models/proyecto.model';
import {
  ObraSubcontratista, SubcontratistaFrente, ObraCubicacion, CubicacionEvento,
  CubicacionEstado, CUBICACION_ESTADOS,
} from '../../../../shared/models/obra-produccion.model';
import { formatFechaDisplay } from '../../../../shared/utils/fecha.util';
import { FormDrawer } from '../../../../shared/components/form-drawer/form-drawer';
import { Skeleton } from '../../../../shared/components/skeleton/skeleton';

type Tab = 'subcontratistas' | 'cubicaciones';

@Component({
  selector: 'app-obra-subcontratistas',
  imports: [ReactiveFormsModule, DecimalPipe, FormDrawer, Skeleton],
  templateUrl: './subcontratistas.html',
  styleUrl: './subcontratistas.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ObraSubcontratistas implements OnInit {
  private service = inject(ObraProduccionService);
  private proyectosService = inject(ProyectosService);
  private userService = inject(UserService);
  private toast = inject(ToastService);

  readonly CUB_ESTADOS = CUBICACION_ESTADOS;
  formatFecha = formatFechaDisplay;

  tab = signal<Tab>('subcontratistas');
  loading = signal(true);
  saving = signal(false);

  subcontratistas = signal<ObraSubcontratista[]>([]);
  proyectos = signal<Proyecto[]>([]);
  cubicaciones = signal<ObraCubicacion[]>([]);

  filtroEstado = signal<string>('all');

  puedeOperar = computed(() => this.userService.puedeOperarSubmodulo('obra.subcontratistas'));

  cubicacionesFiltradas = computed(() => {
    const e = this.filtroEstado();
    return e === 'all' ? this.cubicaciones() : this.cubicaciones().filter((c) => c.estado === e);
  });

  // Drawers
  subOpen = signal(false);
  detailSub = signal<ObraSubcontratista | null>(null);
  frentes = signal<SubcontratistaFrente[]>([]);
  frenteOpen = signal(false);
  cubOpen = signal(false);
  detailCub = signal<ObraCubicacion | null>(null);
  cubEventos = signal<CubicacionEvento[]>([]);
  rechazarOpen = signal(false);

  subForm = new FormGroup({
    nombre: new FormControl('', [Validators.required]),
    especialidad: new FormControl<string | null>(null),
    rnc: new FormControl<string | null>(null),
    contacto: new FormControl<string | null>(null),
    telefono: new FormControl<string | null>(null),
  });

  frenteForm = new FormGroup({
    proyecto_id: new FormControl<string | null>(null, [Validators.required]),
    descripcion: new FormControl<string | null>(null),
    avance_pct: new FormControl<number>(0, [Validators.min(0), Validators.max(100)]),
  });

  cubForm = new FormGroup({
    subcontratista_id: new FormControl<string | null>(null, [Validators.required]),
    proyecto_id: new FormControl<string | null>(null, [Validators.required]),
    periodo_inicio: new FormControl<string | null>(null),
    periodo_fin: new FormControl<string | null>(null),
    descripcion: new FormControl<string | null>(null),
    monto: new FormControl<number>(0, [Validators.required, Validators.min(0)]),
    avance_pct: new FormControl<number | null>(null),
  });

  rechazarForm = new FormGroup({ nota: new FormControl('', [Validators.required]) });

  async ngOnInit() {
    await this.loadAll();
  }

  private async loadAll() {
    this.loading.set(true);
    try {
      const [subs, proyectos, cubs] = await Promise.all([
        this.service.getSubcontratistas(),
        this.proyectosService.getAll(),
        this.service.getCubicaciones(),
      ]);
      this.subcontratistas.set(subs);
      this.proyectos.set(proyectos);
      this.cubicaciones.set(cubs);
    } catch (e: unknown) {
      this.toast.error('Error al cargar', e instanceof Error ? e.message : undefined);
    } finally {
      this.loading.set(false);
    }
  }

  setTab(t: Tab) { this.tab.set(t); }

  // ── Subcontratista ──
  openSub() { this.subForm.reset(); this.subOpen.set(true); }
  async saveSub() {
    this.subForm.markAllAsTouched();
    if (this.subForm.invalid || this.saving()) return;
    this.saving.set(true);
    try {
      const s = await this.service.crearSubcontratista(this.subForm.value as Partial<ObraSubcontratista>);
      this.subcontratistas.update((l) => [...l, s].sort((a, b) => a.nombre.localeCompare(b.nombre)));
      this.subOpen.set(false);
      this.toast.success('Subcontratista registrado');
    } catch (e: unknown) {
      this.toast.error('Error', e instanceof Error ? e.message : undefined);
    } finally {
      this.saving.set(false);
    }
  }

  async openDetailSub(s: ObraSubcontratista) {
    this.detailSub.set(s);
    this.frentes.set([]);
    try { this.frentes.set(await this.service.getFrentes(s.id)); } catch { /* ignore */ }
  }
  closeDetailSub() { this.detailSub.set(null); }

  openFrente() { this.frenteForm.reset({ avance_pct: 0 }); this.frenteOpen.set(true); }
  async saveFrente() {
    this.frenteForm.markAllAsTouched();
    const s = this.detailSub();
    if (!s || this.frenteForm.invalid || this.saving()) return;
    this.saving.set(true);
    try {
      const v = this.frenteForm.value;
      await this.service.crearFrente({
        subcontratistaId: s.id,
        proyectoId: v.proyecto_id!,
        descripcion: v.descripcion || null,
        avancePct: v.avance_pct ?? 0,
      });
      this.frentes.set(await this.service.getFrentes(s.id));
      this.frenteOpen.set(false);
      this.toast.success('Frente asignado');
    } catch (e: unknown) {
      this.toast.error('Error', e instanceof Error ? e.message : undefined);
    } finally {
      this.saving.set(false);
    }
  }
  async cambiarAvance(f: SubcontratistaFrente, valor: string) {
    const n = Math.max(0, Math.min(100, Number(valor) || 0));
    try {
      await this.service.actualizarAvanceFrente(f.id, n);
      this.frentes.update((l) => l.map((x) => (x.id === f.id ? { ...x, avance_pct: n } : x)));
    } catch (e: unknown) {
      this.toast.error('Error', e instanceof Error ? e.message : undefined);
    }
  }

  // ── Cubicación ──
  openCub() { this.cubForm.reset({ monto: 0 }); this.cubOpen.set(true); }
  async saveCub() {
    this.cubForm.markAllAsTouched();
    if (this.cubForm.invalid || this.saving()) return;
    this.saving.set(true);
    try {
      const v = this.cubForm.value;
      await this.service.crearCubicacion({
        subcontratistaId: v.subcontratista_id!,
        proyectoId: v.proyecto_id!,
        periodoInicio: v.periodo_inicio || null,
        periodoFin: v.periodo_fin || null,
        descripcion: v.descripcion || null,
        monto: v.monto ?? 0,
        avancePct: v.avance_pct ?? null,
        soportes: [],
      });
      this.toast.success('Cubicación creada (borrador)');
      this.cubOpen.set(false);
      await this.reloadCubs();
    } catch (e: unknown) {
      this.toast.error('Error', e instanceof Error ? e.message : undefined);
    } finally {
      this.saving.set(false);
    }
  }

  async openDetailCub(c: ObraCubicacion) {
    this.detailCub.set(c);
    this.cubEventos.set([]);
    try { this.cubEventos.set(await this.service.getCubicacionEventos(c.id)); } catch { /* ignore */ }
  }
  closeDetailCub() { this.detailCub.set(null); }

  async enviar(c: ObraCubicacion) {
    try {
      await this.service.enviarCubicacion(c.id);
      this.toast.success('Enviada a revisión');
      await this.reloadCubs();
      if (this.detailCub()?.id === c.id) await this.openDetailCub({ ...c, estado: 'en_revision' });
    } catch (e: unknown) {
      this.toast.error('Error', e instanceof Error ? e.message : undefined);
    }
  }
  async aprobar(c: ObraCubicacion) {
    try {
      await this.service.revisarCubicacion(c.id, 'aprobada', null);
      this.toast.success('Cubicación aprobada');
      this.closeDetailCub();
      await this.reloadCubs();
    } catch (e: unknown) {
      this.toast.error('Error', e instanceof Error ? e.message : undefined);
    }
  }
  openRechazar() { this.rechazarForm.reset({ nota: '' }); this.rechazarOpen.set(true); }
  async rechazar() {
    this.rechazarForm.markAllAsTouched();
    const c = this.detailCub();
    if (!c || this.rechazarForm.invalid) return;
    try {
      await this.service.revisarCubicacion(c.id, 'rechazada', this.rechazarForm.value.nota!);
      this.toast.success('Cubicación rechazada');
      this.rechazarOpen.set(false);
      this.closeDetailCub();
      await this.reloadCubs();
    } catch (e: unknown) {
      this.toast.error('Error', e instanceof Error ? e.message : undefined);
    }
  }

  private async reloadCubs() {
    try { this.cubicaciones.set(await this.service.getCubicaciones()); } catch { /* ignore */ }
  }

  subNombre(id: string): string { return this.subcontratistas().find((s) => s.id === id)?.nombre ?? '—'; }
  cubEstadoBadge(e: CubicacionEstado): string { return 'sgc-badge sgc-badge--' + (this.CUB_ESTADOS.find((x) => x.value === e)?.badge ?? 'neutral'); }
  cubEstadoLabel(e: CubicacionEstado): string { return this.CUB_ESTADOS.find((x) => x.value === e)?.label ?? e; }

  get fS() { return this.subForm.controls; }
  get fF() { return this.frenteForm.controls; }
  get fC() { return this.cubForm.controls; }
  get fR() { return this.rechazarForm.controls; }
}
