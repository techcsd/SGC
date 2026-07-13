import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ConteosService, Conteo, StockBodegaRow } from '../../../../shared/services/conteos.service';
import { BodegasService } from '../../../../shared/services/bodegas.service';
import { Bodega } from '../../../../shared/models/bodega.model';
import { FormDrawer } from '../../../../shared/components/form-drawer/form-drawer';
import { ToastService } from '../../../../shared/services/toast.service';

interface ChequeoRow extends StockBodegaRow {
  contada: number;
}

/** Conteo / ajuste history + registro de chequeo semanal de almacén (A5). */
@Component({
  selector: 'app-inventario-conteos',
  imports: [DatePipe, FormsModule, FormDrawer],
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
  expandedId = signal<string | null>(null);

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
    if (!q) return this.conteos();
    return this.conteos().filter(
      (c) =>
        (c.bodega?.nombre ?? '').toLowerCase().includes(q) ||
        (c.creado?.nombre ?? '').toLowerCase().includes(q),
    );
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
