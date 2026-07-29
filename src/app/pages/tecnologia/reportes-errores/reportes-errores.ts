import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { AppErrorReportsService } from '../../../../shared/services/app-error-reports.service';
import {
  AppErrorReport,
  AppErrorGrupo,
  AppErrorType,
  AppErrorFiltros,
  APP_ERROR_TYPES,
} from '../../../../shared/models/app-error-report.model';
import { formatTimestampDisplay } from '../../../../shared/utils/fecha.util';
import { exportarExcel } from '../../../../shared/utils/exportar-excel.util';
import { DateRangeFilter, RangoFecha } from '../../../../shared/ui/date-range-filter/date-range-filter';
import { Skeleton } from '../../../../shared/components/skeleton/skeleton';

@Component({
  selector: 'app-tec-reportes-errores',
  imports: [DecimalPipe, DateRangeFilter, Skeleton],
  templateUrl: './reportes-errores.html',
  styleUrl: './reportes-errores.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TecReportesErrores implements OnInit {
  private service = inject(AppErrorReportsService);

  readonly tipos = APP_ERROR_TYPES;

  // ── Vista: agrupado (por mensaje) / detalle (filas) ──
  vista = signal<'agrupado' | 'detalle'>('agrupado');

  // ── Filtros ──
  fTipo = signal<AppErrorType | ''>('');
  fSource = signal<'' | 'app' | 'web'>('');
  fDispositivo = signal('');
  fVersion = signal('');
  fDesde = signal<string | null>(null);
  fHasta = signal<string | null>(null);

  dispositivos = signal<string[]>([]);

  // ── Datos ──
  rows = signal<AppErrorReport[]>([]);
  grupos = signal<AppErrorGrupo[]>([]);
  total = signal(0);
  page = signal(0);
  loading = signal(false);
  error = signal('');
  expandedId = signal<string | null>(null);
  exportando = signal(false);

  totalPages = computed(() => Math.max(1, Math.ceil(this.total() / this.service.pageSize)));
  rangeLabel = computed(() => {
    if (this.total() === 0) return 'Sin resultados';
    const from = this.page() * this.service.pageSize + 1;
    const to = Math.min(from + this.service.pageSize - 1, this.total());
    return `${from}–${to} de ${this.total()}`;
  });

  /** Conteo por tipo dentro de los grupos cargados (para las tarjetas KPI). */
  conteoPorTipo = computed(() => {
    const acc: Record<string, number> = {};
    for (const g of this.grupos()) acc[g.error_type] = (acc[g.error_type] ?? 0) + g.ocurrencias;
    return acc;
  });
  totalOcurrencias = computed(() => this.grupos().reduce((s, g) => s + g.ocurrencias, 0));

  hasFilters = computed(
    () => !!(this.fTipo() || this.fSource() || this.fDispositivo() || this.fVersion() || this.fDesde() || this.fHasta()),
  );

  ngOnInit() {
    void this.service.getDeviceModels().then((d) => this.dispositivos.set(d));
    void this.load();
  }

  private filtros(): AppErrorFiltros {
    return {
      errorType: this.fTipo() || null,
      source: this.fSource() || null,
      deviceModel: this.fDispositivo() || null,
      appVersion: this.fVersion().trim() || null,
      desde: this.fDesde() ? `${this.fDesde()}T00:00:00` : null,
      hasta: this.fHasta() ? `${this.fHasta()}T23:59:59.999` : null,
    };
  }

  async load() {
    this.loading.set(true);
    this.error.set('');
    try {
      if (this.vista() === 'agrupado') {
        this.grupos.set(await this.service.getGrupos(this.filtros()));
      } else {
        const { rows, total } = await this.service.getReports(this.filtros(), this.page());
        this.rows.set(rows);
        this.total.set(total);
      }
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'Error al cargar los reportes.');
    } finally {
      this.loading.set(false);
    }
  }

  cambiarVista(v: 'agrupado' | 'detalle') {
    if (this.vista() === v) return;
    this.vista.set(v);
    this.page.set(0);
    this.expandedId.set(null);
    void this.load();
  }

  applyFilters() {
    this.page.set(0);
    void this.load();
  }

  clearFilters() {
    this.fTipo.set('');
    this.fSource.set('');
    this.fDispositivo.set('');
    this.fVersion.set('');
    this.fDesde.set(null);
    this.fHasta.set(null);
    this.applyFilters();
  }

  onRango(r: RangoFecha) {
    this.fDesde.set(r.desde);
    this.fHasta.set(r.hasta);
  }

  goToPage(p: number) {
    if (p < 0 || p >= this.totalPages()) return;
    this.page.set(p);
    this.expandedId.set(null);
    void this.load();
  }

  toggle(id: string) {
    this.expandedId.set(this.expandedId() === id ? null : id);
  }

  /** Filtra por el mensaje de un grupo y salta a la vista de detalle. */
  verGrupo(g: AppErrorGrupo) {
    this.fVersion.set('');
    this.vista.set('detalle');
    this.page.set(0);
    // No hay filtro exacto por firma en el server; reutilizamos el tipo y el
    // rango, y el usuario ve las filas del tipo. (La firma agrupa por mensaje.)
    this.fTipo.set(g.error_type);
    void this.load();
  }

  tipoLabel(t: string): string {
    return this.tipos.find((x) => x.value === t)?.label ?? t;
  }

  formatTs(iso: string): string {
    return formatTimestampDisplay(iso);
  }

  contextStr(ctx: Record<string, unknown> | null): string {
    if (!ctx || Object.keys(ctx).length === 0) return '';
    try {
      return JSON.stringify(ctx, null, 2);
    } catch {
      return String(ctx);
    }
  }

  async exportar() {
    this.exportando.set(true);
    try {
      // Exporta hasta 5 páginas (por seguridad) de lo que coincide con el filtro.
      const cap = 10;
      const all: AppErrorReport[] = [];
      for (let p = 0; p < cap; p++) {
        const { rows, total } = await this.service.getReports(this.filtros(), p);
        all.push(...rows);
        if (all.length >= total) break;
      }
      const filas = all.map((r) => ({
        Fecha: this.formatTs(r.created_at),
        Tipo: this.tipoLabel(r.error_type),
        Marca: r.device_brand ?? '',
        Modelo: r.device_model ?? '',
        SO: r.os_version ?? '',
        'Versión app': r.app_version ?? '',
        Plataforma: r.platform ?? '',
        Mensaje: r.message,
        Contexto: this.contextStr(r.context),
      }));
      await exportarExcel('reportes-errores-app', filas);
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'Error al exportar.');
    } finally {
      this.exportando.set(false);
    }
  }
}
