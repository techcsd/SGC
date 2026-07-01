import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  computed,
  OnInit,
} from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { DatePipe } from '@angular/common';
import { SalidasService } from '../../../../shared/services/salidas.service';
import { ArticulosService } from '../../../../shared/services/articulos.service';
import { BodegasService } from '../../../../shared/services/bodegas.service';
import { ObrasService } from '../../../../shared/services/obras.service';
import { UserService } from '../../../core/services/user.service';
import { SalidaInventario, SalidaItemFormData, MOTIVOS_SALIDA } from '../../../../shared/models/salida.model';
import { Articulo } from '../../../../shared/models/articulo.model';
import { Bodega } from '../../../../shared/models/bodega.model';
import { Obra } from '../../../../shared/models/obra.model';
import { FormDrawer } from '../../../../shared/components/form-drawer/form-drawer';

@Component({
  selector: 'app-salidas',
  imports: [ReactiveFormsModule, FormDrawer, DatePipe],
  templateUrl: './salidas.html',
  styleUrl: './salidas.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Salidas implements OnInit {
  private salidasService = inject(SalidasService);
  private articulosService = inject(ArticulosService);
  private bodegasService = inject(BodegasService);
  private obrasService = inject(ObrasService);
  private userService = inject(UserService);

  // ── Data state ──────────────────────────────────────────
  salidas = signal<SalidaInventario[]>([]);
  articulos = signal<Articulo[]>([]);
  bodegas = signal<Bodega[]>([]);
  obras = signal<Obra[]>([]);
  loading = signal(true);
  saving = signal(false);
  error = signal('');
  saveError = signal('');

  // ── Filters ──────────────────────────────────────────────
  searchQuery = signal('');
  selectedBodega = signal<string>('');
  selectedMotivo = signal<string>('');
  dateFrom = signal<string>('');
  dateTo = signal<string>('');

  // ── Pagination ───────────────────────────────────────────
  currentPage = signal(1);
  readonly PAGE_SIZE = 20;

  // ── Drawer ───────────────────────────────────────────────
  drawerOpen = signal(false);
  formItems = signal<SalidaItemFormData[]>([{ articulo_id: '', cantidad: 1 }]);

  readonly MOTIVOS_SALIDA = MOTIVOS_SALIDA;

  readonly today = new Date().toISOString().slice(0, 10);

  form = new FormGroup({
    bodega_id: new FormControl<string>('', [Validators.required]),
    obra_id: new FormControl<string | null>(null),
    motivo: new FormControl<string>('', [Validators.required]),
    fecha: new FormControl<string>(this.today, [Validators.required]),
    responsable: new FormControl<string | null>(null),
    observaciones: new FormControl<string | null>(null),
  });

  // ── Computed ─────────────────────────────────────────────
  activeObras = computed(() => this.obras().filter((o) => o.activo));

  filtered = computed(() => {
    const q = this.searchQuery().toLowerCase().trim();
    const bodega = this.selectedBodega();
    const motivo = this.selectedMotivo();
    const from = this.dateFrom();
    const to = this.dateTo();

    return this.salidas().filter((s) => {
      if (
        q &&
        !(s.responsable ?? '').toLowerCase().includes(q) &&
        !(s.obra?.nombre ?? '').toLowerCase().includes(q)
      ) {
        return false;
      }
      if (bodega && s.bodega_id !== bodega) return false;
      if (motivo && s.motivo !== motivo) return false;
      if (from && s.fecha < from) return false;
      if (to && s.fecha > to) return false;
      return true;
    });
  });

  paginated = computed(() => {
    const start = (this.currentPage() - 1) * this.PAGE_SIZE;
    return this.filtered().slice(start, start + this.PAGE_SIZE);
  });

  totalPages = computed(() => Math.ceil(this.filtered().length / this.PAGE_SIZE));

  showObraField = computed(() => this.form.controls.motivo.value === 'uso_proyecto');

  hasActiveFilters = computed(
    () =>
      !!this.searchQuery() ||
      !!this.selectedBodega() ||
      !!this.selectedMotivo() ||
      !!this.dateFrom() ||
      !!this.dateTo(),
  );

  async ngOnInit() {
    await this.loadAll();
  }

  private async loadAll() {
    this.loading.set(true);
    this.error.set('');
    try {
      const [salidas, arts, bods, obras] = await Promise.all([
        this.salidasService.getAll(),
        this.articulosService.getAll(),
        this.bodegasService.getAll(),
        this.obrasService.getAll(),
      ]);
      this.salidas.set(salidas);
      this.articulos.set(arts);
      this.bodegas.set(bods);
      this.obras.set(obras);
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

  onMotivoChange(value: string) {
    this.selectedMotivo.set(value);
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
    this.selectedMotivo.set('');
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
    this.formItems.set([{ articulo_id: '', cantidad: 1 }]);
    this.drawerOpen.set(true);
  }

  closeDrawer() {
    this.drawerOpen.set(false);
  }

  addItem() {
    this.formItems.update((items) => [...items, { articulo_id: '', cantidad: 1 }]);
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

  async onSave() {
    this.form.markAllAsTouched();
    const items = this.formItems().filter((i) => i.articulo_id && i.cantidad > 0);
    if (this.form.invalid || this.saving() || items.length === 0) return;

    this.saving.set(true);
    this.saveError.set('');

    const v = this.form.value;

    try {
      const userId = this.userService.profile()?.id ?? null;
      const created = await this.salidasService.create(
        {
          bodega_id: v.bodega_id!,
          obra_id: v.motivo === 'uso_proyecto' ? (v.obra_id ?? null) : null,
          motivo: v.motivo!,
          fecha: v.fecha!,
          responsable: v.responsable ?? null,
          observaciones: v.observaciones ?? null,
          items,
        },
        userId,
      );
      this.salidas.update((list) => [created, ...list]);
      this.drawerOpen.set(false);
    } catch (e: unknown) {
      this.saveError.set(e instanceof Error ? e.message : 'Error al guardar.');
    } finally {
      this.saving.set(false);
    }
  }

  // ── Helpers ──────────────────────────────────────────────
  getMotivoLabel(motivo: string): string {
    return MOTIVOS_SALIDA.find((m) => m.value === motivo)?.label ?? motivo;
  }

  getMotivoModifier(motivo: string): string {
    const map: Record<string, string> = {
      uso_proyecto: 'info',
      venta: 'success',
      merma: 'danger',
      devolucion: 'warning',
      ajuste: 'neutral',
      otro: 'neutral',
    };
    return map[motivo] ?? 'neutral';
  }

  get f() {
    return this.form.controls;
  }
}
