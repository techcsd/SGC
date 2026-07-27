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
import { HighlightItemDirective } from '../../../../shared/directives/highlight-item.directive';
import { DecimalPipe } from '@angular/common';
import { ArticulosService } from '../../../../shared/services/articulos.service';
import { CategoriasService } from '../../../../shared/services/categorias.service';
import { StockService } from '../../../../shared/services/stock.service';
import { UnidadesService } from '../../../../shared/services/unidades.service';
import {
  Articulo,
  ArticuloFormData,
  ARTICULO_PROPIEDADES,
  propiedadLabel,
  propiedadBadge,
} from '../../../../shared/models/articulo.model';
import { StockPorBodega } from '../../../../shared/models/stock.model';
import { Unidad } from '../../../../shared/models/unidad.model';
import { CategoriaFlat } from '../../../../shared/models/categoria.model';
import { FormDrawer } from '../../../../shared/components/form-drawer/form-drawer';
import { Skeleton } from '../../../../shared/components/skeleton/skeleton';
import { exportarExcel } from '../../../../shared/utils/exportar-excel.util';

@Component({
  selector: 'app-articulos',
  imports: [Skeleton, ReactiveFormsModule, FormDrawer, DecimalPipe, HighlightItemDirective],
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
  // Q3/R11 — drill-down desde dashboards/reportes: ?stock=critico | sin.
  selectedStock = signal<'all' | 'critico' | 'sin'>('all');
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
    propiedad: new FormControl<'propio_csd' | 'alquilado'>('propio_csd', { nonNullable: true }),
  }, { validators: maxGteMin('stock_minimo', 'stock_maximo') });

  // ── Z16/Z17 — propiedad + foto ────────────────────────────
  readonly PROPIEDADES = ARTICULO_PROPIEDADES;
  readonly propiedadLabel = propiedadLabel;
  readonly propiedadBadge = propiedadBadge;

  /** Foto seleccionada en el formulario (aún sin subir) + preview local. */
  private fotoFile: File | null = null;
  fotoPreview = signal<string | null>(null);
  /** Path/URL de la imagen ya guardada del artículo en edición. */
  imagenActualUrl = signal<string | null>(null);

  /** Thumbnails firmados por artículo (para la lista). */
  fotoThumbs = signal<Record<string, string>>({});

  // ── Detalle (modal W11) ───────────────────────────────────
  detalle = signal<Articulo | null>(null);
  detalleFotoUrl = signal<string | null>(null);
  detalleStock = signal<StockPorBodega[]>([]);
  detalleMovs = signal<{ tipo: string; fecha: string; cantidad: number; bodega: string | null; proyecto: string | null }[]>([]);
  detalleLoading = signal(false);

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
      // Q3/R11 — filtros de stock desde reportes/dashboard.
      if (stock === 'critico') {
        const st = this.getStockStatus(a);
        if (st !== 'low' && st !== 'none') return false;
      }
      if (stock === 'sin' && this.getStockStatus(a) !== 'none') return false;
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
    // Q3/R11 — drill-down desde dashboards/reportes: preaplica filtros de la ruta.
    const qp = this.route.snapshot.queryParamMap;
    const stock = qp.get('stock');
    if (stock === 'critico' || stock === 'sin') this.selectedStock.set(stock);
    const cat = qp.get('categoria');
    if (cat) this.selectedCategory.set(Number(cat));
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
      this.resolverThumbs();
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
    this.resetFoto(null);
    this.form.reset({ activo: true, stock_minimo: 0, propiedad: 'propio_csd', requiere_talla: false });
    this.drawerOpen.set(true);
  }

  openEdit(article: Articulo) {
    this.editingId.set(article.id);
    this.saveError.set('');
    this.resetFoto(article.imagen_url ?? null);
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
      propiedad: article.propiedad ?? 'propio_csd',
    });
    this.drawerOpen.set(true);
  }

  closeDrawer() {
    this.drawerOpen.set(false);
  }

  // ── Z17 — foto en el formulario ───────────────────────────
  private async resetFoto(imagenUrl: string | null) {
    this.fotoFile = null;
    this.fotoPreview.set(null);
    this.imagenActualUrl.set(null);
    if (imagenUrl) {
      try {
        this.imagenActualUrl.set(await this.articulosService.getFotoUrl(imagenUrl, { width: 320, quality: 80 }));
      } catch {
        /* imagen no resoluble → sin preview */
      }
    }
  }

  onFotoSeleccionada(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    if (!file) return;
    this.fotoFile = file;
    this.fotoPreview.set(URL.createObjectURL(file));
  }

  quitarFoto() {
    this.fotoFile = null;
    this.fotoPreview.set(null);
    this.imagenActualUrl.set(null);
    // Marca para borrar la imagen guardada al salvar.
    this.form.markAsDirty();
  }

  async onSave() {
    this.form.markAllAsTouched();
    if (this.form.invalid || this.saving()) return;

    this.saving.set(true);
    this.saveError.set('');

    const payload = this.form.getRawValue() as unknown as ArticuloFormData;
    // imagen_url: si se quitó la foto y no hay nueva, se limpia; si no cambió, se
    // conserva (no lo mandamos para no pisarlo).
    if (!this.fotoFile && !this.imagenActualUrl()) payload.imagen_url = null;

    try {
      const id = this.editingId();
      if (id) {
        if (this.fotoFile) {
          payload.imagen_url = await this.articulosService.uploadFoto(id, this.fotoFile);
        } else if (this.imagenActualUrl()) {
          delete payload.imagen_url; // sin cambio de foto → no tocar
        }
        const updated = await this.articulosService.update(id, payload);
        this.articles.update((list) => list.map((a) => (a.id === id ? updated : a)));
      } else {
        const created = await this.articulosService.create(payload);
        if (this.fotoFile) {
          const path = await this.articulosService.uploadFoto(created.id, this.fotoFile);
          const updated = await this.articulosService.update(created.id, { imagen_url: path });
          this.articles.update((list) => [updated, ...list]);
        } else {
          this.articles.update((list) => [created, ...list]);
        }
      }
      this.drawerOpen.set(false);
      this.resolverThumbs();
    } catch (e: unknown) {
      this.saveError.set(e instanceof Error ? e.message : 'Error al guardar.');
    } finally {
      this.saving.set(false);
    }
  }

  // ── Z17 — thumbnails de la lista ──────────────────────────
  /** Resuelve (perezosamente) los thumbnails firmados de los artículos con foto. */
  async resolverThumbs() {
    const pend = this.articles().filter((a) => a.imagen_url && !this.fotoThumbs()[a.id]);
    for (const a of pend) {
      try {
        const url = await this.articulosService.getFotoUrl(a.imagen_url!, { width: 96, height: 96, quality: 70 });
        this.fotoThumbs.update((m) => ({ ...m, [a.id]: url }));
      } catch {
        /* ignora fotos irresolubles */
      }
    }
  }

  thumbDe(a: Articulo): string | null {
    return this.fotoThumbs()[a.id] ?? null;
  }

  // ── Z17 — detalle del artículo (modal) ────────────────────
  async abrirDetalle(a: Articulo) {
    this.detalle.set(a);
    this.detalleFotoUrl.set(null);
    this.detalleStock.set([]);
    this.detalleMovs.set([]);
    this.detalleLoading.set(true);
    try {
      const [stock, movs] = await Promise.all([
        this.stockService.getByArticulo(a.id),
        this.articulosService.getUltimosMovimientos(a.id, 10),
      ]);
      this.detalleStock.set(stock);
      this.detalleMovs.set(movs);
      if (a.imagen_url) {
        this.detalleFotoUrl.set(await this.articulosService.getFotoUrl(a.imagen_url, { width: 640, quality: 85 }));
      }
    } catch {
      /* detalle parcial si falla algo */
    } finally {
      this.detalleLoading.set(false);
    }
  }

  cerrarDetalle() {
    this.detalle.set(null);
  }

  detalleStockTotal = computed(() => this.detalleStock().reduce((s, r) => s + (r.cantidad ?? 0), 0));

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

  /** Z16 — marca rápida de propiedad desde el listado (backfill). Optimista. */
  async togglePropiedad(article: Articulo) {
    const next = (article.propiedad ?? 'propio_csd') === 'alquilado' ? 'propio_csd' : 'alquilado';
    this.articles.update((list) => list.map((a) => (a.id === article.id ? { ...a, propiedad: next } : a)));
    try {
      await this.articulosService.setPropiedad(article.id, next);
    } catch {
      this.articles.update((list) =>
        list.map((a) => (a.id === article.id ? { ...a, propiedad: article.propiedad } : a)),
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
