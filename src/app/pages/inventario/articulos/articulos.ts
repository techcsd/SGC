import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  computed,
  OnInit,
} from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { maxGteMin } from '../../../../shared/utils/form-validators.util';
import { DecimalPipe } from '@angular/common';
import { ArticulosService } from '../../../../shared/services/articulos.service';
import { CategoriasService } from '../../../../shared/services/categorias.service';
import { StockService } from '../../../../shared/services/stock.service';
import { UnidadesService } from '../../../../shared/services/unidades.service';
import { Articulo, ArticuloFormData } from '../../../../shared/models/articulo.model';
import { Unidad } from '../../../../shared/models/unidad.model';
import { CategoriaFlat } from '../../../../shared/models/categoria.model';
import { FormDrawer } from '../../../../shared/components/form-drawer/form-drawer';
import { Skeleton } from '../../../../shared/components/skeleton/skeleton';
import { exportarExcel } from '../../../../shared/utils/exportar-excel.util';

@Component({
  selector: 'app-articulos',
  imports: [Skeleton, ReactiveFormsModule, FormDrawer, DecimalPipe],
  templateUrl: './articulos.html',
  styleUrl: './articulos.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Articulos implements OnInit {
  private articulosService = inject(ArticulosService);
  private categoriasService = inject(CategoriasService);
  private stockService = inject(StockService);
  private unidadesService = inject(UnidadesService);

  // ── Data state ──────────────────────────────────────────
  articles = signal<Articulo[]>([]);
  categories = signal<CategoriaFlat[]>([]);
  stockMap = signal<Map<string, number>>(new Map());
  loading = signal(true);
  saving = signal(false);
  error = signal('');
  saveError = signal('');

  // ── Filters ──────────────────────────────────────────────
  searchQuery = signal('');
  selectedCategory = signal<number | null>(null);
  selectedStatus = signal<'all' | 'active' | 'inactive'>('all');
  // Q3 — drill-down desde el dashboard (?stock=critico): solo stock bajo/agotado.
  selectedStock = signal<'all' | 'critico'>('all');
  private route = inject(ActivatedRoute);

  // ── Pagination ───────────────────────────────────────────
  currentPage = signal(1);
  readonly PAGE_SIZE = 20;

  // ── Drawer ───────────────────────────────────────────────
  drawerOpen = signal(false);
  editingId = signal<string | null>(null);

  unidades = signal<Unidad[]>([]);

  form = new FormGroup({
    codigo: new FormControl({ value: '', disabled: true }),
    nombre: new FormControl('', [Validators.required, Validators.maxLength(200)]),
    descripcion: new FormControl<string | null>(null),
    categoria_id: new FormControl<number | null>(null, [Validators.required]),
    unidad: new FormControl<string | null>(null, [Validators.required]),
    stock_minimo: new FormControl<number>(0, [Validators.required, Validators.min(0)]),
    stock_maximo: new FormControl<number | null>(null, [Validators.min(0)]),
    precio_estimado: new FormControl<number | null>(null, [Validators.min(0)]),
    activo: new FormControl<boolean>(true),
    requiere_talla: new FormControl<boolean>(false, { nonNullable: true }),
    nota: new FormControl<string | null>(null),
  }, { validators: maxGteMin('stock_minimo', 'stock_maximo') });

  // ── Computed ─────────────────────────────────────────────
  filtered = computed(() => {
    const q = this.searchQuery().toLowerCase().trim();
    const catId = this.selectedCategory();
    const status = this.selectedStatus();
    const stock = this.selectedStock();

    return this.articles().filter((a) => {
      if (q && !a.nombre.toLowerCase().includes(q) && !a.codigo.toLowerCase().includes(q)) {
        return false;
      }
      if (catId && a.categoria_id !== catId) return false;
      if (status === 'active' && !a.activo) return false;
      if (status === 'inactive' && a.activo) return false;
      // Q3 — crítico = stock bajo o agotado (mismo criterio que getStockStatus).
      if (stock === 'critico') {
        const st = this.getStockStatus(a);
        if (st !== 'low' && st !== 'none') return false;
      }
      return true;
    });
  });

  paginated = computed(() => {
    const start = (this.currentPage() - 1) * this.PAGE_SIZE;
    return this.filtered().slice(start, start + this.PAGE_SIZE);
  });

  totalPages = computed(() => Math.ceil(this.filtered().length / this.PAGE_SIZE));

  drawerTitle = computed(() =>
    this.editingId() ? 'Editar artículo' : 'Nuevo artículo',
  );

  async ngOnInit() {
    // Q3 — drill-down desde el KPI "Artículos en stock crítico".
    if (this.route.snapshot.queryParamMap.get('stock') === 'critico') {
      this.selectedStock.set('critico');
    }
    await this.loadAll();
  }

  private async loadAll() {
    this.loading.set(true);
    this.error.set('');
    try {
      const [cats, arts, stock, unidades] = await Promise.all([
        this.categoriasService.getAll(),
        this.articulosService.getAll(),
        this.stockService.getAll(),
        this.unidadesService.getActivas(),
      ]);
      this.categories.set(this.categoriasService.buildFlatList(cats));
      this.articles.set(arts);
      this.stockMap.set(this.stockService.buildTotalMap(stock));
      this.unidades.set(unidades);
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

  onStatusChange(value: string) {
    this.selectedStatus.set(value as 'all' | 'active' | 'inactive');
    this.currentPage.set(1);
  }

  clearFilters() {
    this.searchQuery.set('');
    this.selectedCategory.set(null);
    this.selectedStatus.set('all');
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

  /** Exporta los artículos filtrados a Excel. */
  async exportar() {
    const rows = this.filtered().map((a) => ({
      Código: a.codigo,
      Nombre: a.nombre,
      Categoría: this.getCategoryName(a.categoria_id),
      Unidad: a.unidad,
      Stock: this.getStock(a.id),
      Activo: a.activo ? 'Sí' : 'No',
    }));
    await exportarExcel('articulos', rows);
  }

  // ── Drawer ───────────────────────────────────────────────
  openCreate() {
    this.editingId.set(null);
    this.saveError.set('');
    this.form.reset({ activo: true, stock_minimo: 0 });
    this.drawerOpen.set(true);
  }

  openEdit(article: Articulo) {
    this.editingId.set(article.id);
    this.saveError.set('');
    this.form.reset({
      codigo: article.codigo,
      nombre: article.nombre,
      descripcion: article.descripcion,
      categoria_id: article.categoria_id,
      unidad: article.unidad,
      stock_minimo: article.stock_minimo,
      stock_maximo: article.stock_maximo,
      precio_estimado: article.precio_estimado,
      activo: article.activo,
      requiere_talla: article.requiere_talla ?? false,
      nota: article.nota ?? null,
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

    const payload = this.form.value as ArticuloFormData;

    try {
      const id = this.editingId();
      if (id) {
        const updated = await this.articulosService.update(id, payload);
        this.articles.update((list) => list.map((a) => (a.id === id ? updated : a)));
      } else {
        const created = await this.articulosService.create(payload);
        this.articles.update((list) => [created, ...list]);
      }
      this.drawerOpen.set(false);
    } catch (e: unknown) {
      this.saveError.set(e instanceof Error ? e.message : 'Error al guardar.');
    } finally {
      this.saving.set(false);
    }
  }

  // ── Actions ──────────────────────────────────────────────
  async toggleActivo(article: Articulo) {
    const next = !article.activo;
    this.articles.update((list) =>
      list.map((a) => (a.id === article.id ? { ...a, activo: next } : a)),
    );
    try {
      await this.articulosService.toggleActivo(article.id, next);
    } catch {
      // revert on error
      this.articles.update((list) =>
        list.map((a) => (a.id === article.id ? { ...a, activo: !next } : a)),
      );
    }
  }

  // ── Helpers ──────────────────────────────────────────────
  getStock(articuloId: string): number {
    return this.stockMap().get(articuloId) ?? 0;
  }

  getStockStatus(article: Articulo): 'none' | 'low' | 'ok' | 'inactive' {
    if (!article.activo) return 'inactive';
    const total = this.getStock(article.id);
    if (total <= 0) return 'none';
    return total <= article.stock_minimo ? 'low' : 'ok';
  }

  getCategoryName(id: number): string {
    return this.categories().find((c) => c.id === id)?.nombre ?? '—';
  }

  get f() {
    return this.form.controls;
  }
}
