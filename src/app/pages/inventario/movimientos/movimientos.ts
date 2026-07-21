import { Component, ChangeDetectionStrategy, inject, signal, computed, OnInit } from '@angular/core';
import { RouterLink, ActivatedRoute, Router } from '@angular/router';
import { MovimientosService, MovimientoInventario } from '../../../../shared/services/movimientos.service';
import { BodegasService } from '../../../../shared/services/bodegas.service';
import { ProyectosService } from '../../../../shared/services/proyectos.service';
import { Bodega } from '../../../../shared/models/bodega.model';
import { Proyecto } from '../../../../shared/models/proyecto.model';
import { Skeleton } from '../../../../shared/components/skeleton/skeleton';
import { DateRangeFilter, RangoFecha } from '../../../../shared/ui/date-range-filter/date-range-filter';
import { formatFechaDisplay } from '../../../../shared/utils/fecha.util';
import { exportarExcel } from '../../../../shared/utils/exportar-excel.util';

/** U16 — Movimientos de inventario: entradas y salidas, con su conduce vinculado. */
@Component({
  selector: 'app-inventario-movimientos',
  imports: [Skeleton, RouterLink, DateRangeFilter],
  templateUrl: './movimientos.html',
  styleUrl: './movimientos.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Movimientos implements OnInit {
  private movimientosService = inject(MovimientosService);
  private bodegasService = inject(BodegasService);
  private proyectosService = inject(ProyectosService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  formatFecha = formatFechaDisplay;

  private movimientos = signal<MovimientoInventario[]>([]);
  bodegas = signal<Bodega[]>([]);
  proyectos = signal<Proyecto[]>([]);
  loading = signal(true);
  error = signal('');

  selectedBodega = signal('');
  selectedTipo = signal('');
  dateFrom = signal('');
  dateTo = signal('');

  private bodegaNombreMap = computed(() => new Map(this.bodegas().map((b) => [b.id, b.nombre])));
  private obraNombreMap = computed(() => new Map(this.proyectos().map((p) => [p.id, p.nombre])));

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
      const [movs, bodegas, proyectos] = await Promise.all([
        this.movimientosService.getMovimientos(),
        this.bodegasService.getAll(),
        this.proyectosService.getAll(),
      ]);
      this.movimientos.set(movs);
      this.bodegas.set(bodegas);
      this.proyectos.set(proyectos);
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'Error al cargar los movimientos.');
    } finally {
      this.loading.set(false);
    }
  }

  bodegaNombre(id: string): string {
    return this.bodegaNombreMap().get(id) ?? '—';
  }

  /** P12 — nombre de la obra de origen de una devolución (o '' si no aplica). */
  obraNombre(id: string | null): string {
    return id ? (this.obraNombreMap().get(id) ?? '') : '';
  }

  /** R8 — todo abre su origen: entrada → Entradas (resaltada); salida → su conduce. */
  abrir(m: MovimientoInventario) {
    if (m.tipo === 'salida') {
      this.router.navigate(['/inventario/salidas', m.referencia_id, 'conduce']);
    } else {
      this.router.navigate(['/inventario/entradas'], { queryParams: { item: m.referencia_id } });
    }
  }

  onBodega(v: string) { this.selectedBodega.set(v); }
  onTipo(v: string) { this.selectedTipo.set(v); }
  onFrom(v: string) { this.dateFrom.set(v); }
  onTo(v: string) { this.dateTo.set(v); }
  /** R12 — filtro de fechas unificado (presets + rango). */
  onRango(r: RangoFecha) { this.dateFrom.set(r.desde ?? ''); this.dateTo.set(r.hasta ?? ''); }
  clearFilters() {
    this.selectedBodega.set('');
    this.selectedTipo.set('');
    this.dateFrom.set('');
    this.dateTo.set('');
  }

  /** Exporta los movimientos filtrados a Excel. */
  async exportar() {
    const rows = this.filtered().map((m) => ({
      Fecha: this.formatFecha(m.fecha),
      Tipo: m.tipo === 'salida' ? 'Salida' : 'Entrada',
      Almacén: this.bodegaNombre(m.bodega_id),
      'Concepto / referencia': m.concepto || '',
      Origen: m.origen_tipo === 'devolucion_obra'
        ? `Devolución de obra${this.obraNombre(m.origen_proyecto_id) ? ': ' + this.obraNombre(m.origen_proyecto_id) : ''}`
        : '',
      Artículos: m.items,
      Responsable: m.responsable || '',
    }));
    await exportarExcel('movimientos-inventario', rows);
  }
}
