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
import { SalidasService } from '../../../../shared/services/salidas.service';
import { ArticulosService } from '../../../../shared/services/articulos.service';
import { BodegasService } from '../../../../shared/services/bodegas.service';
import { UserService } from '../../../core/services/user.service';
import { SalidaInventario, SalidaFormData, MotivoSalida, MOTIVOS_SALIDA } from '../../../../shared/models/salida.model';
import { Articulo } from '../../../../shared/models/articulo.model';
import { Bodega } from '../../../../shared/models/bodega.model';
import { FormDrawer } from '../../../../shared/components/form-drawer/form-drawer';

@Component({
  selector: 'app-salidas',
  imports: [ReactiveFormsModule, FormDrawer, DatePipe, DecimalPipe],
  templateUrl: './salidas.html',
  styleUrl: './salidas.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Salidas implements OnInit {
  private salidasService = inject(SalidasService);
  private articulosService = inject(ArticulosService);
  private bodegasService = inject(BodegasService);
  private userService = inject(UserService);

  // ── Data state ──────────────────────────────────────────
  salidas = signal<SalidaInventario[]>([]);
  articulos = signal<Articulo[]>([]);
  bodegas = signal<Bodega[]>([]);
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

  readonly MOTIVOS_SALIDA = MOTIVOS_SALIDA;

  readonly today = new Date().toISOString().slice(0, 10);

  form = new FormGroup({
    articulo_id: new FormControl<string>('', [Validators.required]),
    bodega_id: new FormControl<string>('', [Validators.required]),
    cantidad: new FormControl<number | null>(null, [Validators.required, Validators.min(0.01)]),
    motivo: new FormControl<MotivoSalida | ''>('', [Validators.required]),
    fecha: new FormControl<string>(this.today, [Validators.required]),
    proyecto_referencia: new FormControl<string | null>(null),
    referencia: new FormControl<string | null>(null),
    notas: new FormControl<string | null>(null),
  });

  // ── Computed ─────────────────────────────────────────────
  filtered = computed(() => {
    const q = this.searchQuery().toLowerCase().trim();
    const bodega = this.selectedBodega();
    const motivo = this.selectedMotivo();
    const from = this.dateFrom();
    const to = this.dateTo();

    return this.salidas().filter((s) => {
      if (
        q &&
        !s.articulo?.nombre.toLowerCase().includes(q) &&
        !s.articulo?.codigo.toLowerCase().includes(q)
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

  showProyectoField = computed(() => this.form.controls.motivo.value === 'uso_proyecto');

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
      const [salidas, arts, bods] = await Promise.all([
        this.salidasService.getAll(),
        this.articulosService.getAll(),
        this.bodegasService.getAll(),
      ]);
      this.salidas.set(salidas);
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

    const v = this.form.value;
    const payload: SalidaFormData = {
      articulo_id: v.articulo_id!,
      bodega_id: v.bodega_id!,
      cantidad: v.cantidad!,
      motivo: v.motivo as MotivoSalida,
      fecha: v.fecha!,
      proyecto_referencia: v.motivo === 'uso_proyecto' ? (v.proyecto_referencia ?? null) : null,
      referencia: v.referencia ?? null,
      notas: v.notas ?? null,
    };

    try {
      // TODO: pass authenticated user id when auth context is wired up
      const userId = this.userService.profile()?.id ?? null;
      const created = await this.salidasService.create(payload, userId);
      this.salidas.update((list) => [created, ...list]);
      this.drawerOpen.set(false);
    } catch (e: unknown) {
      this.saveError.set(e instanceof Error ? e.message : 'Error al guardar.');
    } finally {
      this.saving.set(false);
    }
  }

  // ── Helpers ──────────────────────────────────────────────
  getMotivoLabel(motivo: MotivoSalida): string {
    return MOTIVOS_SALIDA.find((m) => m.value === motivo)?.label ?? motivo;
  }

  getMotivoModifier(motivo: MotivoSalida): string {
    const map: Record<MotivoSalida, string> = {
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
