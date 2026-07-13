import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { StockService, ReposicionRow } from '../../../../shared/services/stock.service';
import { BodegasService } from '../../../../shared/services/bodegas.service';
import { Bodega } from '../../../../shared/models/bodega.model';

/**
 * A3.1 — Reposición por almacén: artículos en o bajo el stock mínimo de un almacén.
 * Señal operativa para el Guarda-Almacén (solo cantidades; sin cuadre ni montos).
 */
@Component({
  selector: 'app-inventario-reposicion',
  imports: [],
  templateUrl: './reposicion.html',
  styleUrl: './reposicion.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Reposicion implements OnInit {
  private stockService = inject(StockService);
  private bodegasService = inject(BodegasService);

  bodegas = signal<Bodega[]>([]);
  selectedBodega = signal<string>('');
  rows = signal<ReposicionRow[]>([]);
  loading = signal(false);
  error = signal('');

  cargado = computed(() => !!this.selectedBodega());

  async ngOnInit() {
    try {
      this.bodegas.set((await this.bodegasService.getAll()).filter((b) => b.activo));
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'Error al cargar los almacenes.');
    }
  }

  async onBodegaChange(bodegaId: string) {
    this.selectedBodega.set(bodegaId);
    this.rows.set([]);
    if (!bodegaId) return;
    this.loading.set(true);
    this.error.set('');
    try {
      this.rows.set(await this.stockService.getReposicion(bodegaId));
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'Error al cargar la reposición.');
    } finally {
      this.loading.set(false);
    }
  }
}
