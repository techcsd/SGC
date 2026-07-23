import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ConteosService, Conteo, StockBodegaRow } from '../../../../shared/services/conteos.service';
import { BodegasService } from '../../../../shared/services/bodegas.service';
import { Bodega } from '../../../../shared/models/bodega.model';
import { FormDrawer } from '../../../../shared/components/form-drawer/form-drawer';
import { ToastService } from '../../../../shared/services/toast.service';
import { Skeleton } from '../../../../shared/components/skeleton/skeleton';
import { DateRangeFilter, RangoFecha } from '../../../../shared/ui/date-range-filter/date-range-filter';
import { Paginator } from '../../../../shared/ui/paginator/paginator';

interface ChequeoRow extends StockBodegaRow {
  contada: number;
}

/** Conteo / ajuste history + registro de chequeo semanal de almacén (A5). */
@Component({
  selector: 'app-inventario-conteos',
  imports: [DatePipe, FormsModule, FormDrawer, Skeleton, DateRangeFilter, Paginator],
  templateUrl: './conteos.html',
  styleUrl: './conteos.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Conteos implements OnInit {
  private service = inject(ConteosService);
  private bodegasService = inject(BodegasService);
  private toast = inject(ToastService);

  conteos = signal<Conteo[]>([]);
  bodegas = signal<Bodega[]>([]);
  loading = signal(true);
  error = signal('');
  search = signal('');
  // R9 — filtros por almacén y rango de fecha.
  filtroBodega = signal('');
  desde = signal('');
  hasta = signal('');
  expandedId = signal<string | null>(null);

  page = signal(1);
  readonly PAGE_SIZE = 20;

  // Filtros con reset de paginación.
  onSearch(v: string) { this.search.set(v); this.page.set(1); }
  onFiltroBodega(v: string) { this.filtroBodega.set(v); this.page.set(1); }
  onRango(r: RangoFecha) { this.desde.set(r.desde ?? ''); this.hasta.set(r.hasta ?? ''); this.page.set(1); }
  hayFiltros = computed(() => !!(this.search() || this.filtroBodega() || this.desde() || this.hasta()));
  limpiarFiltros() { this.search.set(''); this.filtroBodega.set(''); this.desde.set(''); this.hasta.set(''); this.page.set(1); }

  // ── Chequeo semanal (create) ──
  drawerOpen = signal(false);
  saving = signal(false);
  saveError = signal('');
  chequeoBodegaId = signal<string>('');
  chequeoObs = signal<string>('');
  loadingStock = signal(false);
  chequeoRows = signal<ChequeoRow[]>([]);

  filtered = computed(() => {
    const q = this.search().toLowerCase().trim();
    const bod = this.filtroBodega();
    const desde = this.desde();
    const hasta = this.hasta();
    return this.conteos().filter((c) => {
      if (q && !(c.bodega?.nombre ?? '').toLowerCase().includes(q) && !(c.creado?.nombre ?? '').toLowerCase().includes(q)) return false;
      if (bod && c.bodega_id !== bod) return false;
      // c.created_at es timestamp ISO; comparamos solo la parte de fecha.
      const fecha = (c.created_at ?? '').slice(0, 10);
      if (desde && fecha < desde) return false;
      if (hasta && fecha > hasta) return false;
      return true;
    });
  });

  paginated = computed(() => {
    const start = (this.page() - 1) * this.PAGE_SIZE;
    return this.filtered().slice(start, start + this.PAGE_SIZE);
  });

  async ngOnInit() {
    this.loading.set(true);
    try {
      const [conteos, bodegas] = await Promise.all([this.service.getAll(), this.bodegasService.getAll()]);
      this.conteos.set(conteos);
      this.bodegas.set(bodegas.filter((b) => b.activo));
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'Error al cargar.');
    } finally {
      this.loading.set(false);
    }
  }

  toggle(id: string) {
    this.expandedId.set(this.expandedId() === id ? null : id);
  }

  diff(antes: number, contada: number): string {
    const d = contada - antes;
    return d > 0 ? `+${d}` : `${d}`;
  }

  // R9 — % de desviación del conteo (contada vs antes).
  pctDesvio(antes: number, contada: number): string {
    if (!antes) return contada ? '—' : '0%';
    const pct = ((contada - antes) / antes) * 100;
    const r = Math.round(pct);
    return `${r > 0 ? '+' : ''}${r}%`;
  }

  // R9 — totales del conteo: ítems ajustados (Δ≠0) y ajuste neto (±).
  totales(c: Conteo): { ajustados: number; neto: number } {
    const items = c.items ?? [];
    let ajustados = 0;
    let neto = 0;
    for (const it of items) {
      const d = it.cantidad_contada - it.cantidad_antes;
      if (d !== 0) ajustados++;
      neto += d;
    }
    return { ajustados, neto };
  }

  esChequeo(c: Conteo): boolean {
    return c.tipo === 'chequeo_semanal';
  }

  // ── Chequeo semanal ──
  openChequeo() {
    this.saveError.set('');
    this.chequeoBodegaId.set('');
    this.chequeoObs.set('');
    this.chequeoRows.set([]);
    this.drawerOpen.set(true);
  }

  closeDrawer() {
    this.drawerOpen.set(false);
  }

  async onChequeoBodegaChange(bodegaId: string) {
    this.chequeoBodegaId.set(bodegaId);
    this.chequeoRows.set([]);
    if (!bodegaId) return;
    this.loadingStock.set(true);
    try {
      const stock = await this.service.getStockDeBodega(bodegaId);
      // physical count defaults to the system quantity; the user corrects it.
      this.chequeoRows.set(stock.map((s) => ({ ...s, contada: Number(s.cantidad) })));
    } catch (e: unknown) {
      this.saveError.set(e instanceof Error ? e.message : 'Error al cargar el stock del almacén.');
    } finally {
      this.loadingStock.set(false);
    }
  }

  updateContada(index: number, value: string) {
    this.chequeoRows.update((rows) =>
      rows.map((r, i) => (i === index ? { ...r, contada: Number(value) } : r)),
    );
  }

  async onSaveChequeo() {
    const bodegaId = this.chequeoBodegaId();
    if (!bodegaId) {
      this.saveError.set('Selecciona el almacén.');
      return;
    }
    const rows = this.chequeoRows();
    if (rows.length === 0) {
      this.saveError.set('El almacén no tiene artículos con stock para chequear.');
      return;
    }
    if (this.saving()) return;
    this.saving.set(true);
    this.saveError.set('');
    try {
      await this.service.registrarChequeoSemanal(
        bodegaId,
        this.chequeoObs() || null,
        rows.map((r) => ({ articulo_id: r.articulo_id, cantidad_contada: r.contada })),
      );
      const dif = rows.filter((r) => r.contada !== Number(r.cantidad)).length;
      this.toast.success(
        'Chequeo semanal registrado',
        dif > 0 ? `${dif} diferencia(s) detectada(s) — se notificó a Dirección.` : 'Sin diferencias con el sistema.',
      );
      this.conteos.set(await this.service.getAll());
      this.drawerOpen.set(false);
    } catch (e: unknown) {
      this.saveError.set(e instanceof Error ? e.message : 'Error al guardar el chequeo.');
    } finally {
      this.saving.set(false);
    }
  }
}
