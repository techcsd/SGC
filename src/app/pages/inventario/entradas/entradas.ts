import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  computed,
  OnInit,
} from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { DatePipe, DecimalPipe } from '@angular/common';
import { EntradasService } from '../../../../shared/services/entradas.service';
import { ArticulosService } from '../../../../shared/services/articulos.service';
import { BodegasService } from '../../../../shared/services/bodegas.service';
import { ProveedoresService } from '../../../../shared/services/proveedores.service';
import { AuthService } from '../../../core/services/auth.service';
import { EntradaInventario, EntradaItemFormData } from '../../../../shared/models/entrada.model';
import { Articulo } from '../../../../shared/models/articulo.model';
import { Bodega } from '../../../../shared/models/bodega.model';
import { Proveedor } from '../../../../shared/models/proveedor.model';
import { FormDrawer } from '../../../../shared/components/form-drawer/form-drawer';

@Component({
  selector: 'app-entradas',
  imports: [ReactiveFormsModule, FormDrawer, DatePipe, DecimalPipe],
  templateUrl: './entradas.html',
  styleUrl: './entradas.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Entradas implements OnInit {
  private entradasService = inject(EntradasService);
  private articulosService = inject(ArticulosService);
  private bodegasService = inject(BodegasService);
  private proveedoresService = inject(ProveedoresService);
  private authService = inject(AuthService);

  // ── Data state ──────────────────────────────────────────
  entries = signal<EntradaInventario[]>([]);
  articulos = signal<Articulo[]>([]);
  bodegas = signal<Bodega[]>([]);
  proveedores = signal<Proveedor[]>([]);
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

  readonly today = new Date().toISOString().split('T')[0];

  form = new FormGroup({
    bodega_id: new FormControl('', [Validators.required]),
    proveedor_id: new FormControl<string | null>(null),
    fecha: new FormControl(this.today, [Validators.required]),
    referencia: new FormControl<string | null>(null),
    observaciones: new FormControl<string | null>(null),
  });

  // ── Computed ─────────────────────────────────────────────
  activeProveedores = computed(() => this.proveedores().filter((p) => p.activo));

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
      const [entries, arts, bods, provs] = await Promise.all([
        this.entradasService.getAll(),
        this.articulosService.getAll(),
        this.bodegasService.getAll(),
        this.proveedoresService.getAll(),
      ]);
      this.entries.set(entries);
      this.articulos.set(arts);
      this.bodegas.set(bods);
      this.proveedores.set(provs);
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

  updateItemCantidad(index: number, value: string) {
    this.formItems.update((items) =>
      items.map((item, i) => (i === index ? { ...item, cantidad: Number(value) } : item)),
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

    this.saving.set(true);
    this.saveError.set('');

    try {
      const user = await this.authService.getUser();
      const v = this.form.value;
      const created = await this.entradasService.create(
        {
          bodega_id: v.bodega_id!,
          proveedor_id: v.proveedor_id ?? null,
          fecha: v.fecha!,
          referencia: v.referencia ?? null,
          observaciones: v.observaciones ?? null,
          items,
        },
        user?.id ?? null,
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
