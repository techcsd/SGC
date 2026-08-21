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
import { ActivosService } from '../../../../shared/services/activos.service';
import { CategoriasService } from '../../../../shared/services/categorias.service';
import { ProyectosService } from '../../../../shared/services/proyectos.service';
import { EmpleadosService } from '../../../../shared/services/empleados.service';
import { BodegasService } from '../../../../shared/services/bodegas.service';
import { VehiculosService } from '../../../../shared/services/vehiculos.service';
import {
  ActivoFijo,
  ActivoFormData,
  ACTIVO_ESTADOS,
  ActivoEstado,
  ActivoAsignadoTipo,
  ACTIVO_ASIGNADO_TIPOS,
} from '../../../../shared/models/activo.model';
import { CategoriaFlat } from '../../../../shared/models/categoria.model';
import { FormDrawer } from '../../../../shared/components/form-drawer/form-drawer';
import { Skeleton } from '../../../../shared/components/skeleton/skeleton';
import { formatFechaDisplay, todayIso } from '../../../../shared/utils/fecha.util';
import { DatosPruebaViewService } from '../../../../shared/services/datos-prueba-view.service';
import { DatosPruebaService } from '../../../../shared/services/datos-prueba.service';
import { ToastService } from '../../../../shared/services/toast.service';
import { UserService } from '../../../core/services/user.service';

@Component({
  selector: 'app-activos',
  imports: [ReactiveFormsModule, FormDrawer, DecimalPipe, Skeleton],
  templateUrl: './activos.html',
  styleUrl: './activos.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Activos implements OnInit {
  formatFecha = formatFechaDisplay;

  private activosService = inject(ActivosService);
  private categoriasService = inject(CategoriasService);
  private proyectosService = inject(ProyectosService);
  private empleadosService = inject(EmpleadosService);
  private bodegasService = inject(BodegasService);
  private vehiculosService = inject(VehiculosService);
  private datosPruebaViewSvc = inject(DatosPruebaViewService);
  private datosPrueba = inject(DatosPruebaService);
  private toast = inject(ToastService);
  private userService = inject(UserService);

  esAdmin = computed(() => this.userService.hasRole('admin'));
  mostrarPrueba = this.datosPruebaViewSvc.ver;

  // ── Data state ──────────────────────────────────────────
  activos = signal<ActivoFijo[]>([]);
  categories = signal<CategoriaFlat[]>([]);

  // Y8 — listas de entidades relacionables (id + etiqueta) para el selector.
  readonly ACTIVO_ASIGNADO_TIPOS = ACTIVO_ASIGNADO_TIPOS;
  asignables = signal<Record<ActivoAsignadoTipo, { id: string; label: string }[]>>({
    proyecto: [],
    empleado: [],
    ingeniero: [],
    almacen: [],
    vehiculo: [],
  });
  /** Espejo reactivo del tipo elegido en el form (para el computed con OnPush). */
  asignadoTipoSel = signal<ActivoAsignadoTipo | null>(null);
  asignadoOpciones = computed(() => {
    const t = this.asignadoTipoSel();
    return t ? this.asignables()[t] : [];
  });

  loading = signal(true);
  saving = signal(false);
  error = signal('');
  saveError = signal('');

  // ── Filters ──────────────────────────────────────────────
  searchQuery = signal('');
  selectedCategory = signal<number | null>(null);
  selectedEstado = signal<ActivoEstado | 'all'>('all');

  // ── Pagination ───────────────────────────────────────────
  currentPage = signal(1);
  readonly PAGE_SIZE = 20;

  // ── Drawer ───────────────────────────────────────────────
  drawerOpen = signal(false);
  editingId = signal<string | null>(null);

  // ── R8 — Detalle read-only del activo (con depreciación calculada) ───────
  detailOpen = signal(false);
  detailActivo = signal<ActivoFijo | null>(null);
  openDetail(a: ActivoFijo) {
    this.detailActivo.set(a);
    this.detailOpen.set(true);
  }
  closeDetail() {
    this.detailOpen.set(false);
  }

  /** Años transcurridos desde la adquisición (aprox., para la depreciación). */
  antiguedadAnios(a: ActivoFijo): number {
    const adq = new Date(a.fecha_adquisicion).getTime();
    if (isNaN(adq)) return 0;
    return Math.max(0, (Date.now() - adq) / (365.25 * 24 * 3600 * 1000));
  }
  /** Depreciación lineal acumulada; sin vida útil → sin depreciación. */
  depreciacionAcumulada(a: ActivoFijo): number {
    if (!a.vida_util_anios || a.vida_util_anios <= 0) return 0;
    const frac = Math.min(1, this.antiguedadAnios(a) / a.vida_util_anios);
    return a.valor_adquisicion * frac;
  }
  /** Valor actual = adquisición − depreciación acumulada. */
  valorActual(a: ActivoFijo): number {
    return Math.max(0, a.valor_adquisicion - this.depreciacionAcumulada(a));
  }
  estadoLabel(e: string): string {
    return ACTIVO_ESTADOS.find((x) => x.value === e)?.label ?? e;
  }

  readonly ACTIVO_ESTADOS = ACTIVO_ESTADOS;
  readonly today = todayIso();

  form = new FormGroup({
    codigo: new FormControl({ value: '', disabled: true }),
    nombre: new FormControl('', [Validators.required, Validators.maxLength(200)]),
    descripcion: new FormControl<string | null>(null),
    categoria_id: new FormControl<number | null>(null),
    valor_adquisicion: new FormControl<number>(0, [Validators.required, Validators.min(0)]),
    fecha_adquisicion: new FormControl('', [Validators.required]),
    vida_util_anios: new FormControl<number | null>(null, [Validators.min(1)]),
    estado: new FormControl<ActivoEstado>('activo', [Validators.required]),
    ubicacion: new FormControl<string | null>(null),
    asignado_tipo: new FormControl<ActivoAsignadoTipo | null>(null),
    asignado_id: new FormControl<string | null>(null),
    notas: new FormControl<string | null>(null),
    activo: new FormControl<boolean>(true),
    es_prueba: new FormControl<boolean>(false),
  });

  // ── Computed ─────────────────────────────────────────────
  filtered = computed(() => {
    const q = this.searchQuery().toLowerCase().trim();
    const catId = this.selectedCategory();
    const estado = this.selectedEstado();
    const verPrueba = this.esAdmin() && this.mostrarPrueba();

    return this.activos().filter((a) => {
      if (a.es_prueba && !verPrueba) return false;
      if (q && !a.nombre.toLowerCase().includes(q) && !a.codigo.toLowerCase().includes(q)) {
        return false;
      }
      if (catId && a.categoria_id !== catId) return false;
      if (estado !== 'all' && a.estado !== estado) return false;
      return true;
    });
  });

  paginated = computed(() => {
    const start = (this.currentPage() - 1) * this.PAGE_SIZE;
    return this.filtered().slice(start, start + this.PAGE_SIZE);
  });

  totalPages = computed(() => Math.ceil(this.filtered().length / this.PAGE_SIZE));

  drawerTitle = computed(() =>
    this.editingId() ? 'Editar activo fijo' : 'Nuevo activo fijo',
  );

  async ngOnInit() {
    await this.loadAll();
  }

  private async loadAll() {
    this.loading.set(true);
    this.error.set('');
    try {
      const [cats, activos, proyectos, empleados, bodegas, vehiculos, ingenieros] = await Promise.all([
        this.categoriasService.getAll(),
        this.activosService.getAll(),
        this.proyectosService.getAll(),
        this.empleadosService.getAll(),
        this.bodegasService.getAll(),
        this.vehiculosService.getAll(),
        this.proyectosService.getDirectorioUsuarios(),
      ]);
      this.categories.set(this.categoriasService.buildFlatList(cats));
      this.activos.set(activos);
      // Y8 — construir las listas relacionables (id + etiqueta legible).
      this.asignables.set({
        proyecto: this.datosPruebaViewSvc.visibles(proyectos).map((p) => ({ id: p.id, label: p.nombre })),
        empleado: this.datosPruebaViewSvc.visibles(empleados).map((e) => ({ id: e.id, label: `${e.nombre} ${e.apellido ?? ''}`.trim() })),
        ingeniero: ingenieros.map((u) => ({ id: u.id, label: u.nombre })),
        almacen: this.datosPruebaViewSvc.visibles(bodegas).filter((b) => b.activo !== false).map((b) => ({ id: b.id, label: b.nombre })), // AR3
        vehiculo: this.datosPruebaViewSvc.visibles(vehiculos).map((v) => ({ id: v.id, label: `${v.placa} — ${v.marca}` })),
      });
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'Error al cargar los datos.');
    } finally {
      this.loading.set(false);
    }
  }

  // ── Filters ──────────────────────────────────────────────
  onSearch(value: string) {
    this.searchQuery.set(value);
    this.currentPage.set(1);
  }

  onCategoryChange(value: string) {
    this.selectedCategory.set(value ? Number(value) : null);
    this.currentPage.set(1);
  }

  onEstadoChange(value: string) {
    this.selectedEstado.set(value as ActivoEstado | 'all');
    this.currentPage.set(1);
  }

  clearFilters() {
    this.searchQuery.set('');
    this.selectedCategory.set(null);
    this.selectedEstado.set('all');
    this.currentPage.set(1);
  }

  // ── Pagination ───────────────────────────────────────────
  goToPage(page: number) {
    if (page >= 1 && page <= this.totalPages()) {
      this.currentPage.set(page);
    }
  }

  get pages(): number[] {
    const total = this.totalPages();
    const current = this.currentPage();
    const delta = 2;
    const range: number[] = [];
    for (let i = Math.max(1, current - delta); i <= Math.min(total, current + delta); i++) {
      range.push(i);
    }
    return range;
  }

  // ── Drawer ───────────────────────────────────────────────
  openCreate() {
    this.editingId.set(null);
    this.saveError.set('');
    this.form.reset({ activo: true, estado: 'activo', valor_adquisicion: 0, es_prueba: false });
    this.asignadoTipoSel.set(null);
    this.drawerOpen.set(true);
  }

  openEdit(activo: ActivoFijo) {
    this.editingId.set(activo.id);
    this.saveError.set('');
    this.form.reset({
      codigo: activo.codigo,
      nombre: activo.nombre,
      descripcion: activo.descripcion,
      categoria_id: activo.categoria_id,
      valor_adquisicion: activo.valor_adquisicion,
      fecha_adquisicion: activo.fecha_adquisicion,
      vida_util_anios: activo.vida_util_anios,
      estado: activo.estado,
      ubicacion: activo.ubicacion,
      asignado_tipo: activo.asignado_tipo,
      asignado_id: activo.asignado_id,
      notas: activo.notas,
      activo: activo.activo,
      es_prueba: activo.es_prueba ?? false,
    });
    this.asignadoTipoSel.set(activo.asignado_tipo);
    this.drawerOpen.set(true);
  }

  /** Y8 — al cambiar el tipo de relación, refresca las opciones y limpia el id. */
  onAsignadoTipoChange(value: string) {
    const tipo = (value || null) as ActivoAsignadoTipo | null;
    this.asignadoTipoSel.set(tipo);
    this.form.controls.asignado_tipo.setValue(tipo);
    this.form.controls.asignado_id.setValue(null);
  }

  closeDrawer() {
    this.drawerOpen.set(false);
  }

  async onSave() {
    this.form.markAllAsTouched();
    if (this.form.invalid || this.saving()) return;

    this.saving.set(true);
    this.saveError.set('');

    const payload = this.form.value as ActivoFormData;

    // Z5(d) — al marcar un activo existente como prueba, avisar cuántos
    // registros relacionados se marcarán también.
    const idEdit = this.editingId();
    if (idEdit && this.form.value.es_prueba) {
      const n = await this.datosPrueba.contarDerivados('activos_fijos', idEdit, true);
      if (n > 0 && !confirm(`Esto también marcará como prueba ${n} registro(s) relacionado(s). ¿Continuar?`)) {
        this.saving.set(false);
        return;
      }
    }

    try {
      const id = this.editingId();
      if (id) {
        const updated = await this.activosService.update(id, payload);
        this.activos.update((list) => list.map((a) => (a.id === id ? updated : a)));
      } else {
        const created = await this.activosService.create(payload);
        this.activos.update((list) => [created, ...list]);
      }
      this.drawerOpen.set(false);
    } catch (e: unknown) {
      this.saveError.set(e instanceof Error ? e.message : 'Error al guardar.');
    } finally {
      this.saving.set(false);
    }
  }

  // ── Actions ──────────────────────────────────────────────
  async toggleActivo(activo: ActivoFijo) {
    const next = !activo.activo;
    this.activos.update((list) =>
      list.map((a) => (a.id === activo.id ? { ...a, activo: next } : a)),
    );
    try {
      await this.activosService.toggleActivo(activo.id, next);
    } catch {
      // revert on error
      this.activos.update((list) =>
        list.map((a) => (a.id === activo.id ? { ...a, activo: !next } : a)),
      );
    }
  }

  /** Z5(d) — elimina definitivamente una fila de datos de prueba (solo admin). */
  async eliminarPrueba(activo: ActivoFijo) {
    if (!this.esAdmin() || !activo.es_prueba) return;
    if (!confirm(`¿Eliminar el dato de prueba "${activo.nombre}"? Esta acción no se puede deshacer.`)) return;
    try {
      await this.datosPrueba.eliminar('activos_fijos', activo.id);
      this.activos.update((list) => list.filter((x) => x.id !== activo.id));
      this.toast.success('Dato de prueba eliminado', `Se eliminó "${activo.nombre}".`);
    } catch (e: unknown) {
      this.toast.error('Error al eliminar', e instanceof Error ? e.message : 'Intenta de nuevo.');
    }
  }

  // ── Helpers ──────────────────────────────────────────────
  getDepreciacionAnual(activo: ActivoFijo): number | null {
    if (!activo.vida_util_anios || activo.vida_util_anios <= 0) return null;
    return activo.valor_adquisicion / activo.vida_util_anios;
  }

  getEstadoLabel(estado: ActivoEstado): string {
    return ACTIVO_ESTADOS.find((e) => e.value === estado)?.label ?? estado;
  }

  getCategoryName(id: number | null): string {
    if (id === null) return '—';
    return this.categories().find((c) => c.id === id)?.nombre ?? '—';
  }

  /** Y8 — texto legible de la relación del activo (icono + tipo + nombre). */
  asignadoLabel(a: ActivoFijo): string | null {
    if (!a.asignado_tipo || !a.asignado_id) return null;
    const meta = ACTIVO_ASIGNADO_TIPOS.find((t) => t.value === a.asignado_tipo);
    const nombre = this.asignables()[a.asignado_tipo].find((o) => o.id === a.asignado_id)?.label ?? '—';
    return `${meta?.icono ?? ''} ${meta?.label ?? a.asignado_tipo}: ${nombre}`.trim();
  }

  get f() {
    return this.form.controls;
  }
}
