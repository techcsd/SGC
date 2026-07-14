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
import { EntradasService } from '../../../../shared/services/entradas.service';
import { ArticulosService } from '../../../../shared/services/articulos.service';
import { BodegasService } from '../../../../shared/services/bodegas.service';
import { CategoriasService } from '../../../../shared/services/categorias.service';
import { ProveedoresService } from '../../../../shared/services/proveedores.service';
import { OrdenesCompraService } from '../../../../shared/services/ordenes-compra.service';
import { UserService } from '../../../core/services/user.service';
import { EntradaInventario, EntradaItemFormData } from '../../../../shared/models/entrada.model';
import { Articulo } from '../../../../shared/models/articulo.model';
import { Bodega } from '../../../../shared/models/bodega.model';
import { Categoria } from '../../../../shared/models/categoria.model';
import { Proveedor } from '../../../../shared/models/proveedor.model';
import { OrdenCompra } from '../../../../shared/models/orden-compra.model';
import { FormDrawer } from '../../../../shared/components/form-drawer/form-drawer';
import { Skeleton } from '../../../../shared/components/skeleton/skeleton';
import { QtyStepper } from '../../../../shared/ui/qty-stepper/qty-stepper';
import { formatFechaDisplay, todayIso } from '../../../../shared/utils/fecha.util';

@Component({
  selector: 'app-entradas',
  imports: [Skeleton, ReactiveFormsModule, FormDrawer, DecimalPipe, QtyStepper],
  templateUrl: './entradas.html',
  styleUrl: './entradas.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Entradas implements OnInit {
  private entradasService = inject(EntradasService);
  private articulosService = inject(ArticulosService);
  private bodegasService = inject(BodegasService);
  private categoriasService = inject(CategoriasService);
  private proveedoresService = inject(ProveedoresService);
  private ordenesCompraService = inject(OrdenesCompraService);
  private userService = inject(UserService);

  // ── Data state ──────────────────────────────────────────
  entries = signal<EntradaInventario[]>([]);
  articulos = signal<Articulo[]>([]);
  categorias = signal<Categoria[]>([]);
  bodegas = signal<Bodega[]>([]);
  proveedores = signal<Proveedor[]>([]);
  ordenesCompra = signal<OrdenCompra[]>([]);
  loading = signal(true);
  saving = signal(false);
  error = signal('');
  saveError = signal('');

  // ── Filters ──────────────────────────────────────────────
  searchQuery = signal('');
  selectedBodega = signal('');
  dateFrom = signal('');
  dateTo = signal('');

  // ── Pagination ───────────────────────────────────────────
  currentPage = signal(1);
  readonly PAGE_SIZE = 20;

  // ── Drawer ───────────────────────────────────────────────
  drawerOpen = signal(false);
  formItems = signal<EntradaItemFormData[]>([{ articulo_id: '', cantidad: 1, precio_unit: null }]);

  formatFecha = formatFechaDisplay;
  readonly today = todayIso();
  fotoError = signal('');

  /** Open the field evidence photo in a new tab via a fresh signed URL. */
  async verFoto(e: EntradaInventario) {
    if (!e.foto_path) return;
    this.fotoError.set('');
    try {
      const url = await this.entradasService.getFotoUrl(e.foto_path);
      window.open(url, '_blank', 'noopener');
    } catch {
      this.fotoError.set('No se pudo abrir la foto.');
    }
  }

  form = new FormGroup({
    bodega_id: new FormControl<string | null>(null, [Validators.required]),
    proveedor_id: new FormControl<string | null>(null),
    orden_compra_id: new FormControl<string | null>(null),
    fecha: new FormControl(this.today, [Validators.required]),
    referencia: new FormControl<string | null>(null),
    observaciones: new FormControl<string | null>(null),
  });

  // ── Computed ─────────────────────────────────────────────
  activeProveedores = computed(() => this.proveedores().filter((p) => p.activo));

  /**
   * Artículos agrupados por categoría para los <select> (R16). Se itera categorias()
   * — que ya viene destacada-first + orden — emitiendo un grupo por categoría con
   * artículos; los artículos sin categoría activa caen en un grupo final "Otros".
   */
  articulosAgrupados = computed<{ categoria: string; destacada: boolean; articulos: Articulo[] }[]>(() => {
    const arts = this.articulos();
    const cats = this.categorias();
    const byCat = new Map<number, Articulo[]>();
    for (const a of arts) {
      const list = byCat.get(a.categoria_id);
      if (list) list.push(a);
      else byCat.set(a.categoria_id, [a]);
    }
    const grupos: { categoria: string; destacada: boolean; articulos: Articulo[] }[] = [];
    const catIds = new Set<number>();
    for (const c of cats) {
      catIds.add(c.id);
      const list = byCat.get(c.id);
      if (list && list.length) {
        grupos.push({ categoria: c.nombre, destacada: c.destacada, articulos: list });
      }
    }
    const otros = arts.filter((a) => !catIds.has(a.categoria_id));
    if (otros.length) {
      grupos.push({ categoria: 'Otros', destacada: false, articulos: otros });
    }
    return grupos;
  });

  // Only orders still awaiting (full or partial) delivery are valid link targets —
  // matches sgc.registrar_entrada_inventario()'s own check server-side.
  ordenesRecibibles = computed(() =>
    this.ordenesCompra().filter((o) => o.estado === 'aprobada' || o.estado === 'recibida_parcial'),
  );

  filtered = computed(() => {
    const q = this.searchQuery().toLowerCase().trim();
    const bodegaId = this.selectedBodega();
    const from = this.dateFrom();
    const to = this.dateTo();

    return this.entries().filter((e) => {
      if (q && !(e.referencia ?? '').toLowerCase().includes(q) && !(e.proveedor?.nombre ?? '').toLowerCase().includes(q)) {
        return false;
      }
      if (bodegaId && e.bodega_id !== bodegaId) return false;
      if (from && e.fecha < from) return false;
      if (to && e.fecha > to) return false;
      return true;
    });
  });

  paginated = computed(() => {
    const start = (this.currentPage() - 1) * this.PAGE_SIZE;
    return this.filtered().slice(start, start + this.PAGE_SIZE);
  });

  totalPages = computed(() => Math.ceil(this.filtered().length / this.PAGE_SIZE));

  hasActiveFilters = computed(
    () => !!(this.searchQuery() || this.selectedBodega() || this.dateFrom() || this.dateTo()),
  );

  itemsSubtotal = computed(() =>
    this.formItems().reduce((acc, i) => acc + i.cantidad * (i.precio_unit ?? 0), 0),
  );

  async ngOnInit() {
    await this.loadAll();
  }

  private async loadAll() {
    this.loading.set(true);
    this.error.set('');
    try {
      const [entries, arts, cats, bods, provs, ordenes] = await Promise.all([
        this.entradasService.getAll(),
        this.articulosService.getAll(),
        this.categoriasService.getAll(),
        this.bodegasService.getAll(),
        this.proveedoresService.getAll(),
        this.ordenesCompraService.getAll(),
      ]);
      this.entries.set(entries);
      this.articulos.set(arts);
      this.categorias.set(cats);
      this.bodegas.set(bods);
      this.proveedores.set(provs);
      this.ordenesCompra.set(ordenes);
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

  onBodegaChange(value: string) {
    this.selectedBodega.set(value);
    this.currentPage.set(1);
  }

  onDateFromChange(value: string) {
    this.dateFrom.set(value);
    this.currentPage.set(1);
  }

  onDateToChange(value: string) {
    this.dateTo.set(value);
    this.currentPage.set(1);
  }

  clearFilters() {
    this.searchQuery.set('');
    this.selectedBodega.set('');
    this.dateFrom.set('');
    this.dateTo.set('');
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
    this.saveError.set('');
    this.form.reset({ fecha: this.today });
    this.formItems.set([{ articulo_id: '', cantidad: 1, precio_unit: null }]);
    this.drawerOpen.set(true);
  }

  closeDrawer() {
    this.drawerOpen.set(false);
  }

  addItem() {
    this.formItems.update((items) => [...items, { articulo_id: '', cantidad: 1, precio_unit: null }]);
  }

  removeItem(index: number) {
    this.formItems.update((items) => items.filter((_, i) => i !== index));
  }

  updateItemArticulo(index: number, value: string) {
    this.formItems.update((items) =>
      items.map((item, i) => (i === index ? { ...item, articulo_id: value } : item)),
    );
  }

  updateItemCantidad(index: number, value: number | string) {
    const cantidad = Number(value);
    this.formItems.update((items) =>
      items.map((item, i) => (i === index ? { ...item, cantidad } : item)),
    );
  }

  updateItemPrecio(index: number, value: string) {
    this.formItems.update((items) =>
      items.map((item, i) => (i === index ? { ...item, precio_unit: value === '' ? null : Number(value) } : item)),
    );
  }

  itemTotal(item: EntradaItemFormData): number {
    return item.cantidad * (item.precio_unit ?? 0);
  }

  async onSave() {
    this.form.markAllAsTouched();
    const items = this.formItems().filter((i) => i.articulo_id && i.cantidad > 0);
    if (this.form.invalid || this.saving() || items.length === 0) return;

    const articuloIds = items.map((i) => i.articulo_id);
    if (new Set(articuloIds).size !== articuloIds.length) {
      this.saveError.set('No puedes agregar el mismo artículo más de una vez. Combina las cantidades en una sola línea.');
      return;
    }

    // precio_unit is optional (some entries have no known cost yet), but if
    // provided it must be a real non-negative number — catches both a
    // typo'd negative value and a non-numeric input silently becoming NaN.
    if (items.some((i) => i.precio_unit !== null && !(i.precio_unit >= 0))) {
      this.saveError.set('El precio unitario debe ser un número mayor o igual a cero.');
      return;
    }

    this.saving.set(true);
    this.saveError.set('');

    try {
      const userId = this.userService.profile()?.id ?? null;
      const v = this.form.value;
      const created = await this.entradasService.create(
        {
          bodega_id: v.bodega_id!,
          proveedor_id: v.proveedor_id ?? null,
          orden_compra_id: v.orden_compra_id ?? null,
          fecha: v.fecha!,
          referencia: v.referencia ?? null,
          observaciones: v.observaciones ?? null,
          items,
        },
        userId,
      );
      this.entries.update((list) => [created, ...list]);
      this.drawerOpen.set(false);
    } catch (e: unknown) {
      this.saveError.set(e instanceof Error ? e.message : 'Error al guardar.');
    } finally {
      this.saving.set(false);
    }
  }

  // ── Helpers ──────────────────────────────────────────────
  entryTotal(entry: EntradaInventario): number {
    return (entry.detalle_entradas ?? []).reduce(
      (acc, d) => acc + d.cantidad * (d.precio_unit ?? 0),
      0,
    );
  }

  get f() {
    return this.form.controls;
  }
}
