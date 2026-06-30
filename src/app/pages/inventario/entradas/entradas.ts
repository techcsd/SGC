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
import { AuthService } from '../../../core/services/auth.service';
import { EntradaInventario } from '../../../../shared/models/entrada.model';
import { Articulo } from '../../../../shared/models/articulo.model';
import { Bodega } from '../../../../shared/models/bodega.model';
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
  private authService = inject(AuthService);

  // ── Data state ──────────────────────────────────────────
  entries = signal<EntradaInventario[]>([]);
  articulos = signal<Articulo[]>([]);
  bodegas = signal<Bodega[]>([]);
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

  readonly today = new Date().toISOString().split('T')[0];

  form = new FormGroup({
    articulo_id: new FormControl('', [Validators.required]),
    bodega_id: new FormControl('', [Validators.required]),
    cantidad: new FormControl<number | null>(null, [Validators.required, Validators.min(0.01)]),
    fecha: new FormControl(this.today, [Validators.required]),
    costo_unitario: new FormControl<number | null>(null, [Validators.min(0)]),
    proveedor: new FormControl<string | null>(null),
    motivo: new FormControl<string | null>(null),
    referencia: new FormControl<string | null>(null),
  });

  // ── Computed ─────────────────────────────────────────────
  filtered = computed(() => {
    const q = this.searchQuery().toLowerCase().trim();
    const bodegaId = this.selectedBodega();
    const from = this.dateFrom();
    const to = this.dateTo();

    return this.entries().filter((e) => {
      if (
        q &&
        !e.articulo?.nombre.toLowerCase().includes(q) &&
        !e.articulo?.codigo.toLowerCase().includes(q)
      ) {
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

  totalCost = computed(() =>
    this.filtered().reduce(
      (acc, e) => acc + e.cantidad * (e.costo_unitario ?? 0),
      0,
    ),
  );

  hasActiveFilters = computed(
    () => !!(this.searchQuery() || this.selectedBodega() || this.dateFrom() || this.dateTo()),
  );

  async ngOnInit() {
    await this.loadAll();
  }

  private async loadAll() {
    this.loading.set(true);
    this.error.set('');
    try {
      const [entries, arts, bods] = await Promise.all([
        this.entradasService.getAll(),
        this.articulosService.getAll(),
        this.bodegasService.getAll(),
      ]);
      this.entries.set(entries);
      this.articulos.set(arts);
      this.bodegas.set(bods);
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

    try {
      const user = await this.authService.getUser();
      const v = this.form.value;
      const created = await this.entradasService.create(
        {
          articulo_id: v.articulo_id!,
          bodega_id: v.bodega_id!,
          cantidad: v.cantidad!,
          fecha: v.fecha!,
          costo_unitario: v.costo_unitario ?? null,
          proveedor: v.proveedor ?? null,
          motivo: v.motivo ?? null,
          referencia: v.referencia ?? null,
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
  get f() {
    return this.form.controls;
  }
}
