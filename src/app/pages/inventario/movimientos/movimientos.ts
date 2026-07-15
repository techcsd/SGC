import { Component, ChangeDetectionStrategy, inject, signal, computed, OnInit } from '@angular/core';
import { RouterLink, ActivatedRoute } from '@angular/router';
import { MovimientosService, MovimientoInventario } from '../../../../shared/services/movimientos.service';
import { BodegasService } from '../../../../shared/services/bodegas.service';
import { Bodega } from '../../../../shared/models/bodega.model';
import { Skeleton } from '../../../../shared/components/skeleton/skeleton';
import { formatFechaDisplay } from '../../../../shared/utils/fecha.util';

/** U16 — Movimientos de inventario: entradas y salidas, con su conduce vinculado. */
@Component({
  selector: 'app-inventario-movimientos',
  imports: [Skeleton, RouterLink],
  templateUrl: './movimientos.html',
  styleUrl: './movimientos.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Movimientos implements OnInit {
  private movimientosService = inject(MovimientosService);
  private bodegasService = inject(BodegasService);
  private route = inject(ActivatedRoute);

  formatFecha = formatFechaDisplay;

  private movimientos = signal<MovimientoInventario[]>([]);
  bodegas = signal<Bodega[]>([]);
  loading = signal(true);
  error = signal('');

  selectedBodega = signal('');
  selectedTipo = signal('');
  dateFrom = signal('');
  dateTo = signal('');

  private bodegaNombreMap = computed(() => new Map(this.bodegas().map((b) => [b.id, b.nombre])));

  filtered = computed(() => {
    const bod = this.selectedBodega();
    const tipo = this.selectedTipo();
    const from = this.dateFrom();
    const to = this.dateTo();
    return this.movimientos().filter((m) => {
      if (bod && m.bodega_id !== bod) return false;
      if (tipo && m.tipo !== tipo) return false;
      if (from && m.fecha < from) return false;
      if (to && m.fecha > to) return false;
      return true;
    });
  });

  totalSalidas = computed(() => this.filtered().filter((m) => m.tipo === 'salida').length);
  totalEntradas = computed(() => this.filtered().filter((m) => m.tipo === 'entrada').length);
  hasActiveFilters = computed(() => !!(this.selectedBodega() || this.selectedTipo() || this.dateFrom() || this.dateTo()));

  /** U16 — nombre del almacén cuando se llega filtrado desde su detalle. */
  bodegaFiltradaNombre = computed(() =>
    this.selectedBodega() ? this.bodegaNombre(this.selectedBodega()) : '',
  );

  async ngOnInit() {
    // U16 — pre-filtrar por almacén al entrar desde "Ver movimientos".
    const bodega = this.route.snapshot.queryParamMap.get('bodega');
    if (bodega) this.selectedBodega.set(bodega);
    this.loading.set(true);
    this.error.set('');
    try {
      const [movs, bodegas] = await Promise.all([
        this.movimientosService.getMovimientos(),
        this.bodegasService.getAll(),
      ]);
      this.movimientos.set(movs);
      this.bodegas.set(bodegas);
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'Error al cargar los movimientos.');
    } finally {
      this.loading.set(false);
    }
  }

  bodegaNombre(id: string): string {
    return this.bodegaNombreMap().get(id) ?? '—';
  }

  onBodega(v: string) { this.selectedBodega.set(v); }
  onTipo(v: string) { this.selectedTipo.set(v); }
  onFrom(v: string) { this.dateFrom.set(v); }
  onTo(v: string) { this.dateTo.set(v); }
  clearFilters() {
    this.selectedBodega.set('');
    this.selectedTipo.set('');
    this.dateFrom.set('');
    this.dateTo.set('');
  }
}
