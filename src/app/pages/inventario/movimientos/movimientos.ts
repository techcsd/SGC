import { Component, ChangeDetectionStrategy, inject, signal, computed, OnInit } from '@angular/core';
import { RouterLink, ActivatedRoute, Router } from '@angular/router';
import { MovimientosService, MovimientoInventario } from '../../../../shared/services/movimientos.service';
import { BodegasService } from '../../../../shared/services/bodegas.service';
import { ProyectosService } from '../../../../shared/services/proyectos.service';
import { Bodega } from '../../../../shared/models/bodega.model';
import { Proyecto } from '../../../../shared/models/proyecto.model';
import { Skeleton } from '../../../../shared/components/skeleton/skeleton';
import { DateRangeFilter, RangoFecha } from '../../../../shared/ui/date-range-filter/date-range-filter';
import { Paginator } from '../../../../shared/ui/paginator/paginator';
import { Icon } from '../../../../shared/ui/icon/icon';
import { formatFechaDisplay } from '../../../../shared/utils/fecha.util';
import { exportarExcel } from '../../../../shared/utils/exportar-excel.util';
import { DatosPruebaViewService } from '../../../../shared/services/datos-prueba-view.service';
import { ListaEstadoService } from '../../../../shared/services/lista-estado.service';
import { StaggerDirective } from '../../../../shared/motion/stagger.directive';

// CX3.2 — snapshot de filtros/página recordado mientras la persona siga en
// Inventario (ver ListaEstadoService).
interface EstadoMovimientos {
  selectedBodega: string;
  selectedTipo: string;
  dateFrom: string;
  dateTo: string;
  page: number;
}

/** U16 — Movimientos de inventario: entradas y salidas, con su conduce vinculado. */
@Component({
  selector: 'app-inventario-movimientos',
  imports: [Skeleton, RouterLink, DateRangeFilter, Paginator, Icon, StaggerDirective],
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
  private datosPruebaView = inject(DatosPruebaViewService);
  private listaEstado = inject(ListaEstadoService);
  // CX3.2 — clave de pantalla para recordar filtros/página mientras la persona
  // siga en Inventario (se limpia al cambiar de módulo o cerrar sesión).
  private readonly ESTADO_KEY = 'inventario.movimientos';

  formatFecha = formatFechaDisplay;

  private movimientos = signal<MovimientoInventario[]>([]);
  bodegas = signal<Bodega[]>([]);
  // AT14/AT26 — datos de prueba fuera del selector de almacén para no-admin.
  bodegasVisibles = computed(() => this.datosPruebaView.visibles(this.bodegas()));
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

  page = signal(1);
  readonly PAGE_SIZE = 20;
  paginated = computed(() => {
    const start = (this.page() - 1) * this.PAGE_SIZE;
    return this.filtered().slice(start, start + this.PAGE_SIZE);
  });

  totalSalidas = computed(() => this.filtered().filter((m) => m.tipo === 'salida').length);
  totalEntradas = computed(() => this.filtered().filter((m) => m.tipo === 'entrada').length);
  hasActiveFilters = computed(() => !!(this.selectedBodega() || this.selectedTipo() || this.dateFrom() || this.dateTo()));

  /** U16 — nombre del almacén cuando se llega filtrado desde su detalle. */
  bodegaFiltradaNombre = computed(() =>
    this.selectedBodega() ? this.bodegaNombre(this.selectedBodega()) : '',
  );

  async ngOnInit() {
    // U16 — pre-filtrar por almacén al entrar desde "Ver movimientos" (deep-link
    // explícito; gana sobre el estado recordado, CX3.2).
    const bodega = this.route.snapshot.queryParamMap.get('bodega');
    if (bodega) {
      this.selectedBodega.set(bodega);
    } else {
      const guardado = this.listaEstado.obtener<EstadoMovimientos>(this.ESTADO_KEY);
      if (guardado) {
        this.selectedBodega.set(guardado.selectedBodega);
        this.selectedTipo.set(guardado.selectedTipo);
        this.dateFrom.set(guardado.dateFrom);
        this.dateTo.set(guardado.dateTo);
        this.page.set(guardado.page);
      }
    }
    this.loading.set(true);
    this.error.set('');
    try {
      const [movs, bodegas, proyectos] = await Promise.all([
        this.movimientosService.getMovimientos(),
        this.bodegasService.getAll(),
        this.proyectosService.getAll(),
      ]);
      this.movimientos.set(movs);
      this.bodegas.set(bodegas.filter((b) => b.activo !== false)); // AR3 — sin almacenes inactivos
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

  // CX3.2 — el paginador usa [page]/(pageChange) en vez de [(page)] para poder
  // guardar el estado también cuando solo cambia la página.
  onPageChange(p: number) { this.page.set(p); this.guardarEstado(); }

  onBodega(v: string) { this.selectedBodega.set(v); this.page.set(1); this.guardarEstado(); }
  onTipo(v: string) { this.selectedTipo.set(v); this.page.set(1); this.guardarEstado(); }
  onFrom(v: string) { this.dateFrom.set(v); this.page.set(1); this.guardarEstado(); }
  onTo(v: string) { this.dateTo.set(v); this.page.set(1); this.guardarEstado(); }
  /** R12 — filtro de fechas unificado (presets + rango). */
  onRango(r: RangoFecha) { this.dateFrom.set(r.desde ?? ''); this.dateTo.set(r.hasta ?? ''); this.page.set(1); this.guardarEstado(); }
  clearFilters() {
    this.selectedBodega.set('');
    this.selectedTipo.set('');
    this.dateFrom.set('');
    this.dateTo.set('');
    this.page.set(1);
    this.guardarEstado();
  }

  // CX3.2 — se llama tras cada cambio de filtro/página.
  private guardarEstado() {
    this.listaEstado.guardar<EstadoMovimientos>(this.ESTADO_KEY, {
      selectedBodega: this.selectedBodega(),
      selectedTipo: this.selectedTipo(),
      dateFrom: this.dateFrom(),
      dateTo: this.dateTo(),
      page: this.page(),
    });
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
