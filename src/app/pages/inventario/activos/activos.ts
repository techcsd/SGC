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
import { ActivoFijo, ActivoFormData, ACTIVO_ESTADOS, ActivoEstado } from '../../../../shared/models/activo.model';
import { CategoriaFlat } from '../../../../shared/models/categoria.model';
import { FormDrawer } from '../../../../shared/components/form-drawer/form-drawer';
import { formatFechaDisplay, todayIso } from '../../../../shared/utils/fecha.util';

@Component({
  selector: 'app-activos',
  imports: [ReactiveFormsModule, FormDrawer, DecimalPipe],
  templateUrl: './activos.html',
  styleUrl: './activos.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Activos implements OnInit {
  formatFecha = formatFechaDisplay;

  private activosService = inject(ActivosService);
  private categoriasService = inject(CategoriasService);

  // ── Data state ──────────────────────────────────────────
  activos = signal<ActivoFijo[]>([]);
  categories = signal<CategoriaFlat[]>([]);
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
    notas: new FormControl<string | null>(null),
    activo: new FormControl<boolean>(true),
  });

  // ── Computed ─────────────────────────────────────────────
  filtered = computed(() => {
    const q = this.searchQuery().toLowerCase().trim();
    const catId = this.selectedCategory();
    const estado = this.selectedEstado();

    return this.activos().filter((a) => {
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
      const [cats, activos] = await Promise.all([
        this.categoriasService.getAll(),
        this.activosService.getAll(),
      ]);
      this.categories.set(this.categoriasService.buildFlatList(cats));
      this.activos.set(activos);
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
    this.form.reset({ activo: true, estado: 'activo', valor_adquisicion: 0 });
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
      notas: activo.notas,
      activo: activo.activo,
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

    const payload = this.form.value as ActivoFormData;

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

  get f() {
    return this.form.controls;
  }
}
