import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { StockService, ReposicionRow } from '../../../../shared/services/stock.service';
import { BodegasService } from '../../../../shared/services/bodegas.service';
import { Bodega } from '../../../../shared/models/bodega.model';
import { Skeleton } from '../../../../shared/components/skeleton/skeleton';

/**
 * A3.1 — Reposición por almacén: artículos en o bajo el stock mínimo de un almacén.
 * Señal operativa para el Guarda-Almacén (solo cantidades; sin cuadre ni montos).
 */
@Component({
  selector: 'app-inventario-reposicion',
  imports: [Skeleton],
  templateUrl: './reposicion.html',
  styleUrl: './reposicion.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Reposicion implements OnInit {
  private stockService = inject(StockService);
  private bodegasService = inject(BodegasService);

  bodegas = signal<Bodega[]>([]);
  // R10 — '' = sin elegir · 'ALL' = todas las bodegas (global) · <uuid> = una bodega.
  selectedBodega = signal<string>('');
  rows = signal<ReposicionRow[]>([]);
  loading = signal(false);
  error = signal('');
  /** Se hizo una consulta (para distinguir "elige un almacén" de "sin resultados"). */
  consultado = signal(false);

  cargado = computed(() => !!this.selectedBodega());
  esGlobal = computed(() => this.selectedBodega() === 'ALL');

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
    this.consultado.set(false);
    if (!bodegaId) return;
    this.loading.set(true);
    this.error.set('');
    try {
      // 'ALL' → null (vista global = misma fórmula que Reportes › stock crítico).
      this.rows.set(await this.stockService.getReposicion(bodegaId === 'ALL' ? null : bodegaId));
      this.consultado.set(true);
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'Error al cargar la reposición.');
    } finally {
      this.loading.set(false);
    }
  }
}
