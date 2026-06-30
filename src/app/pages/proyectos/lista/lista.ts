import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  computed,
  OnInit,
} from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { DecimalPipe } from '@angular/common';
import { ProyectosService } from '../../../../shared/services/proyectos.service';
import {
  FaseProyecto,
  Proyecto,
  PROYECTO_ESTADOS,
  PROYECTO_TIPOS,
} from '../../../../shared/models/proyecto.model';
import { FormDrawer } from '../../../../shared/components/form-drawer/form-drawer';
import { SupabaseService } from '../../../core/services/supabase.service';

interface UsuarioSimple {
  id: string;
  nombre: string;
}

@Component({
  selector: 'app-lista',
  imports: [ReactiveFormsModule, FormDrawer, DecimalPipe],
  templateUrl: './lista.html',
  styleUrl: './lista.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Lista implements OnInit {
  private proyectosService = inject(ProyectosService);
  private supabase = inject(SupabaseService);

  // ── Data ─────────────────────────────────────────────────
  proyectos = signal<Proyecto[]>([]);
  usuarios = signal<UsuarioSimple[]>([]);
  loading = signal(true);
  saving = signal(false);
  error = signal('');
  saveError = signal('');

  // ── Filters ──────────────────────────────────────────────
  searchQuery = signal('');
  filterEstado = signal('');
  filterTipo = signal('');

  // ── Drawer: create/edit ──────────────────────────────────
  drawerOpen = signal(false);
  editingId = signal<string | null>(null);

  // ── Drawer: detail/fases ─────────────────────────────────
  detailDrawerOpen = signal(false);
  selectedProyecto = signal<Proyecto | null>(null);
  detailLoading = signal(false);

  // ── Fase form ─────────────────────────────────────────────
  faseDrawerOpen = signal(false);
  editingFaseId = signal<string | null>(null);
  faseSaving = signal(false);
  faseError = signal('');

  readonly PROYECTO_ESTADOS = PROYECTO_ESTADOS;
  readonly PROYECTO_TIPOS = PROYECTO_TIPOS;
  readonly FASE_ESTADOS = [
    { value: 'pendiente', label: 'Pendiente' },
    { value: 'en_progreso', label: 'En progreso' },
    { value: 'completada', label: 'Completada' },
  ];

  // ── Main form ─────────────────────────────────────────────
  form = new FormGroup({
    codigo: new FormControl('', [Validators.required]),
    nombre: new FormControl('', [Validators.required]),
    cliente: new FormControl<string | null>(null),
    tipo: new FormControl<string | null>(null),
    estado: new FormControl('planificacion', [Validators.required]),
    fecha_inicio: new FormControl<string | null>(null),
    fecha_fin_estimada: new FormControl<string | null>(null),
    presupuesto: new FormControl<number | null>(null, [Validators.min(0)]),
    ubicacion: new FormControl<string | null>(null),
    descripcion: new FormControl<string | null>(null),
    responsable_id: new FormControl<string | null>(null),
  });

  // ── Fase form ─────────────────────────────────────────────
  faseForm = new FormGroup({
    nombre: new FormControl('', [Validators.required]),
    descripcion: new FormControl<string | null>(null),
    estado: new FormControl('pendiente', [Validators.required]),
    fecha_inicio: new FormControl<string | null>(null),
    fecha_fin: new FormControl<string | null>(null),
    progreso: new FormControl<number>(0, [Validators.min(0), Validators.max(100)]),
    orden: new FormControl<number>(1, [Validators.required, Validators.min(1)]),
  });

  // ── Computed ─────────────────────────────────────────────
  filtered = computed(() => {
    const q = this.searchQuery().toLowerCase().trim();
    const estado = this.filterEstado();
    const tipo = this.filterTipo();

    return this.proyectos().filter((p) => {
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
      return true;
    });
  });

  statsTotal = computed(() => this.proyectos().length);
  statsEnProgreso = computed(() => this.proyectos().filter((p) => p.estado === 'en_progreso').length);
  statsCompletados = computed(() => this.proyectos().filter((p) => p.estado === 'completado').length);
  statsPresupuesto = computed(() =>
    this.proyectos().reduce((sum, p) => sum + (p.presupuesto ?? 0), 0),
  );

  drawerTitle = computed(() => (this.editingId() ? 'Editar proyecto' : 'Nuevo proyecto'));

  async ngOnInit() {
    await Promise.all([this.loadProyectos(), this.loadUsuarios()]);
  }

  private async loadProyectos() {
    this.loading.set(true);
    this.error.set('');
    try {
      this.proyectos.set(await this.proyectosService.getAll());
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

  clearFilters() {
    this.searchQuery.set('');
    this.filterEstado.set('');
    this.filterTipo.set('');
  }

  // ── Create/Edit Drawer ───────────────────────────────────
  openCreate() {
    this.editingId.set(null);
    this.saveError.set('');
    this.form.reset({ estado: 'planificacion' });
    this.drawerOpen.set(true);
  }

  openEdit(p: Proyecto, event: Event) {
    event.stopPropagation();
    this.editingId.set(p.id);
    this.saveError.set('');
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
      descripcion: p.descripcion,
      responsable_id: p.responsable_id,
    });
    this.drawerOpen.set(true);
  }

  closeDrawer() {
    this.drawerOpen.set(false);
  }

  async onSave() {
    this.form.markAllAsTouched();
    if (this.form.invalid || this.saving()) return;

    this.saving.set(true);
    this.saveError.set('');
    const payload = this.form.value as Partial<Proyecto>;

    try {
      const id = this.editingId();
      if (id) {
        const updated = await this.proyectosService.update(id, payload);
        this.proyectos.update((list) => list.map((p) => (p.id === id ? { ...p, ...updated } : p)));
      } else {
        const created = await this.proyectosService.create(payload);
        this.proyectos.update((list) => [created, ...list]);
      }
      this.drawerOpen.set(false);
    } catch (e: unknown) {
      this.saveError.set(e instanceof Error ? e.message : 'Error al guardar.');
    } finally {
      this.saving.set(false);
    }
  }

  // ── Detail Drawer ────────────────────────────────────────
  async openDetail(p: Proyecto) {
    this.detailDrawerOpen.set(true);
    this.selectedProyecto.set(p);
    this.detailLoading.set(true);
    try {
      const full = await this.proyectosService.getById(p.id);
      this.selectedProyecto.set(full);
    } catch {
      // keep basic data
    } finally {
      this.detailLoading.set(false);
    }
  }

  closeDetailDrawer() {
    this.detailDrawerOpen.set(false);
    this.selectedProyecto.set(null);
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
    if (this.faseForm.invalid || this.faseSaving()) return;

    this.faseSaving.set(true);
    this.faseError.set('');
    const proyecto = this.selectedProyecto();
    if (!proyecto) return;

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
