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
import { DecimalPipe } from '@angular/common';
import { ProyectosService } from '../../../../shared/services/proyectos.service';
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
} from '../../../../shared/models/proyecto.model';
import { Empleado } from '../../../../shared/models/empleado.model';
import { EmpleadosService } from '../../../../shared/services/empleados.service';
import { FormDrawer } from '../../../../shared/components/form-drawer/form-drawer';
import { Skeleton } from '../../../../shared/components/skeleton/skeleton';
import { DocumentosProyecto } from '../../../../shared/components/documentos-proyecto/documentos-proyecto';
import { ExpedienteObra } from '../../../../shared/components/expediente-obra/expediente-obra';
import { CuadreObraComponent } from '../../../../shared/components/cuadre-obra/cuadre-obra';
import { EjecucionObra } from '../../../../shared/components/ejecucion-obra/ejecucion-obra';
import { LocationPicker } from '../../../../shared/context/location-picker/location-picker';
import { WeatherCard } from '../../../../shared/context/weather-card/weather-card';
import { SupabaseService } from '../../../core/services/supabase.service';
import { UserService } from '../../../core/services/user.service';
import { formatFechaDisplay } from '../../../../shared/utils/fecha.util';

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
  imports: [Skeleton, ReactiveFormsModule, FormDrawer, DecimalPipe, DocumentosProyecto, ExpedienteObra, CuadreObraComponent, EjecucionObra, LocationPicker, WeatherCard],
  templateUrl: './lista.html',
  styleUrl: './lista.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Lista implements OnInit {
  private proyectosService = inject(ProyectosService);
  private empleadosService = inject(EmpleadosService);
  private supabase = inject(SupabaseService);
  private userService = inject(UserService);

  formatFecha = formatFechaDisplay;

  /** Cuadre + antifraude solo para roles financieros/dirección (no obra). */
  verCuadre = this.userService.verCuadre;

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
  readonly READINESS_ESTRELLAS = READINESS_ESTRELLAS;

  // ── Detail: real spend + team ─────────────────────────────
  gastoReal = signal<number>(0);
  equipo = signal<ProyectoEmpleado[]>([]);
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
      descripcion: new FormControl<string | null>(null),
      responsable_id: new FormControl<string | null>(null),
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
    await Promise.all([
      this.loadProyectos(),
      this.loadUsuarios(),
      this.loadEmpleados(),
      this.loadReadiness(),
    ]);
  }

  /** Carga el readiness (estrellas) de cada proyecto — best-effort, no bloquea. */
  private async loadReadiness() {
    try {
      const rows = await this.proyectosService.getReadiness();
      const map: Record<string, ProyectoReadiness> = {};
      for (const r of rows) map[r.proyecto_id] = r;
      this.readiness.set(map);
    } catch {
      // non-blocking: sin readiness las tarjetas muestran 0 estrellas
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
    this.formLat.set(null);
    this.formLng.set(null);
    this.formDireccionGeo.set(null);
    this.drawerOpen.set(true);
  }

  onUbicacionChange(u: { latitud: number; longitud: number; direccion: string }) {
    this.formLat.set(u.latitud);
    this.formLng.set(u.longitud);
    this.formDireccionGeo.set(u.direccion);
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
    this.formLat.set(p.latitud);
    this.formLng.set(p.longitud);
    this.formDireccionGeo.set(p.direccion_geo);
    this.drawerOpen.set(true);
  }

  closeDrawer() {
    this.drawerOpen.set(false);
  }

  async onSave() {
    this.form.markAllAsTouched();
    if (this.form.invalid || this.saving()) {
      if (this.form.errors?.['fechaOrden']) {
        this.saveError.set('La fecha de inicio no puede ser posterior a la fecha de fin estimada.');
      }
      return;
    }

    // Gate del sistema de estrellas: no se puede iniciar una obra existente
    // hasta cumplir los 4 parámetros de preparación. (Un proyecto nuevo aún no
    // tiene readiness y arranca en 'planificacion', así que no aplica.)
    const editId = this.editingId();
    if (
      editId &&
      this.form.get('estado')?.value === 'en_progreso' &&
      !this.listoParaIniciar(editId)
    ) {
      this.saveError.set(
        'No se puede iniciar la obra: faltan estrellas (equipo, cuadre, expediente y almacén de obra).',
      );
      return;
    }

    this.saving.set(true);
    this.saveError.set('');
    const payload = {
      ...this.form.value,
      latitud: this.formLat(),
      longitud: this.formLng(),
      direccion_geo: this.formDireccionGeo(),
    } as Partial<Proyecto>;

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
    this.equipoLoading.set(true);
    this.gastoReal.set(0);
    this.equipo.set([]);
    try {
      const [full, gasto, equipo] = await Promise.all([
        this.proyectosService.getById(p.id),
        this.proyectosService.getGastoReal(p.id),
        this.proyectosService.getEquipo(p.id),
      ]);
      this.selectedProyecto.set(full);
      this.gastoReal.set(gasto);
      this.equipo.set(equipo);
    } catch {
      // keep basic data
    } finally {
      this.detailLoading.set(false);
      this.equipoLoading.set(false);
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
