import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  computed,
  OnInit,
} from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { maxGteMin } from '../../../../shared/utils/form-validators.util';
import { HighlightItemDirective } from '../../../../shared/directives/highlight-item.directive';
import { DecimalPipe } from '@angular/common';
import { ArticulosService, ArticuloAlias } from '../../../../shared/services/articulos.service';
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
import { ExportExcel, ExportColumn, ExportSection } from '../../../../shared/components/export-excel/export-excel';
import { exportarExcel } from '../../../../shared/utils/exportar-excel.util';
import { UserService } from '../../../core/services/user.service';
import { ToastService } from '../../../../shared/services/toast.service';
import { DatosPruebaViewService } from '../../../../shared/services/datos-prueba-view.service';
import { DatosPruebaService } from '../../../../shared/services/datos-prueba.service';
import { Icon } from '../../../../shared/ui/icon/icon';

@Component({
  selector: 'app-articulos',
  imports: [Skeleton, ReactiveFormsModule, FormDrawer, DecimalPipe, HighlightItemDirective, ExportExcel, RouterLink, Icon],
  templateUrl: './articulos.html',
  styleUrl: './articulos.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Articulos implements OnInit {
  private articulosService = inject(ArticulosService);
  private categoriasService = inject(CategoriasService);
  private stockService = inject(StockService);
  private unidadesService = inject(UnidadesService);
  private userService = inject(UserService);
  private toast = inject(ToastService);
  // Z5(d) — datos de prueba (marcar/ocultar/eliminar), patrón de vehículos.
  private datosPruebaViewSvc = inject(DatosPruebaViewService);
  private datosPrueba = inject(DatosPruebaService);

  // Z5(d) — solo admin ve/gestiona datos de prueba; visibilidad GLOBAL compartida.
  esAdmin = computed(() => this.userService.hasRole('admin'));
  mostrarPrueba = this.datosPruebaViewSvc.ver;

  // Z11/AU1 — quién puede ajustar stock. El ajuste en sí vive ahora en la vista del
  // almacén (modal unificado "Ajustar existencia"); aquí solo se enlaza.
  esInventario = computed(() => this.userService.hasRole('admin') || this.userService.hasModulo('inventario'));

  // ── Data state ──────────────────────────────────────────
  articles = signal<Articulo[]>([]);

  // ── Export a Excel (con seccionado por categoría / propiedad / estado / stock) ──
  private stockStatusLabel(a: Articulo): string {
    return { none: 'Sin stock', low: 'Stock bajo', ok: 'OK', inactive: 'Inactivo' }[this.getStockStatus(a)] ?? '';
  }
  readonly exportCols: ExportColumn[] = [
    { key: 'codigo', label: 'Código', value: (r) => (r as Articulo).codigo },
    { key: 'nombre', label: 'Nombre', value: (r) => (r as Articulo).nombre },
    { key: 'categoria', label: 'Categoría', value: (r) => this.getCategoryName((r as Articulo).categoria_id) },
    { key: 'unidad', label: 'Unidad', value: (r) => (r as Articulo).unidad },
    { key: 'stock', label: 'Stock actual', value: (r) => this.getStock((r as Articulo).id) },
    { key: 'stock_min', label: 'Stock mínimo', value: (r) => (r as Articulo).stock_minimo ?? '' },
    { key: 'propiedad', label: 'Propiedad', value: (r) => ((r as Articulo).propiedad === 'alquilado' ? 'Alquilado' : 'Propio CSD') },
    { key: 'precio', label: 'Precio estimado', value: (r) => (r as Articulo).precio_estimado ?? '' },
    { key: 'estado', label: 'Estado', value: (r) => ((r as Articulo).activo ? 'Activo' : 'Inactivo') },
    { key: 'talla', label: 'Requiere talla', value: (r) => ((r as Articulo).requiere_talla ? 'Sí' : 'No'), default: false },
    { key: 'nota', label: 'Nota', value: (r) => (r as Articulo).nota ?? '', default: false },
  ];
  readonly exportSecciones: ExportSection[] = [
    { key: 'categoria', label: 'Categoría', values: (r) => [this.getCategoryName((r as Articulo).categoria_id)] },
    { key: 'propiedad', label: 'Propiedad', values: (r) => [(r as Articulo).propiedad === 'alquilado' ? 'Alquilado' : 'Propio CSD'] },
    { key: 'estado', label: 'Estado', values: (r) => [(r as Articulo).activo ? 'Activo' : 'Inactivo'] },
    { key: 'stock', label: 'Estado de stock', values: (r) => [this.stockStatusLabel(r as Articulo)] },
    { key: 'unidad', label: 'Unidad', values: (r) => { const u = (r as Articulo).unidad; return u ? [u] : []; } },
  ];
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
  // Z10 — filtro por propiedad (CSD / Alquilado).
  selectedPropiedad = signal<'all' | 'propio_csd' | 'alquilado'>('all');
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
    entrega_en_mano: new FormControl<boolean>(false, { nonNullable: true }), // AF16
    nota: new FormControl<string | null>(null),
    propiedad: new FormControl<'propio_csd' | 'alquilado'>('propio_csd', { nonNullable: true }),
    // Z5(d) — dato de prueba (solo admin lo edita).
    es_prueba: new FormControl<boolean>(false),
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
    // Z5(d) — no-admin: nunca ve datos de prueba. Admin: ocultos salvo el toggle.
    const verPrueba = this.esAdmin() && this.mostrarPrueba();

    return this.articles().filter((a) => {
      if (a.es_prueba && !verPrueba) return false;
      if (q && !a.nombre.toLowerCase().includes(q) && !a.codigo.toLowerCase().includes(q)) {
        return false;
      }
      if (catId && a.categoria_id !== catId) return false;
      const prop = this.selectedPropiedad();
      if (prop !== 'all' && (a.propiedad ?? 'propio_csd') !== prop) return false;
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
    this.selectedPropiedad.set('all');
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
    this.form.reset({ activo: true, stock_minimo: 0, propiedad: 'propio_csd', requiere_talla: false, entrega_en_mano: false, es_prueba: false });
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
      entrega_en_mano: article.entrega_en_mano ?? false, // AF16
      nota: article.nota ?? null,
      propiedad: article.propiedad ?? 'propio_csd',
      es_prueba: article.es_prueba ?? false,
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

    // Z5(d) — al marcar un artículo existente como prueba, avisar cuántos
    // registros relacionados se marcarán también (entradas/salidas de inventario).
    const idEdit = this.editingId();
    if (idEdit && this.form.value.es_prueba) {
      const n = await this.datosPrueba.contarDerivados('articulos', idEdit, true);
      if (n > 0 && !confirm(`Esto también marcará como prueba ${n} registro(s) relacionado(s) (entradas/salidas de inventario). ¿Continuar?`)) {
        this.saving.set(false);
        return;
      }
    }

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
    this.apodos.set([]);
    this.apodoNuevo.set('');
    this.detalleLoading.set(true);
    try {
      const [stock, movs, apodos] = await Promise.all([
        this.stockService.getByArticulo(a.id),
        this.articulosService.getUltimosMovimientos(a.id, 10),
        this.articulosService.listarApodos(a.id).catch(() => []),
      ]);
      this.detalleStock.set(stock);
      this.detalleMovs.set(movs);
      this.apodos.set(apodos);
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

  // ── AU12 — apodos del artículo (agregar/quitar desde el detalle) ─────────────
  apodos = signal<ArticuloAlias[]>([]);
  apodoNuevo = signal('');
  apodoSaving = signal(false);

  async agregarApodo() {
    const d = this.detalle();
    const alias = this.apodoNuevo().trim();
    if (!d || !alias || this.apodoSaving()) return;
    this.apodoSaving.set(true);
    try {
      await this.articulosService.agregarApodo(d.id, alias);
      this.apodos.set(await this.articulosService.listarApodos(d.id));
      this.apodoNuevo.set('');
    } catch (e: unknown) {
      this.toast.error('No se pudo agregar el apodo', e instanceof Error ? e.message : undefined);
    } finally {
      this.apodoSaving.set(false);
    }
  }

  async eliminarApodo(id: string) {
    const d = this.detalle();
    if (!d) return;
    try {
      await this.articulosService.eliminarApodo(id);
      this.apodos.update((list) => list.filter((x) => x.id !== id));
    } catch (e: unknown) {
      this.toast.error('No se pudo eliminar el apodo', e instanceof Error ? e.message : undefined);
    }
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

  /** Z5(d) — elimina definitivamente un artículo de prueba (solo admin). */
  async eliminarPrueba(article: Articulo) {
    if (!this.esAdmin() || !article.es_prueba) return;
    if (!confirm(`¿Eliminar el dato de prueba "${article.nombre}"? Esta acción no se puede deshacer.`)) return;
    try {
      await this.datosPrueba.eliminar('articulos', article.id);
      this.articles.update((list) => list.filter((a) => a.id !== article.id));
      this.toast.success('Dato de prueba eliminado', `Se eliminó "${article.nombre}".`);
    } catch (e: unknown) {
      this.toast.error('Error al eliminar', e instanceof Error ? e.message : 'Intenta de nuevo.');
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
