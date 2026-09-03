import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { AppErrorReportsService } from '../../../../shared/services/app-error-reports.service';
import {
  AppErrorReport,
  AppErrorGrupo,
  AppErrorType,
  AppErrorFiltros,
  AppErrorEstado,
  AppErrorOcurrencia,
  APP_ERROR_TYPES,
} from '../../../../shared/models/app-error-report.model';
import { formatTimestampDisplay } from '../../../../shared/utils/fecha.util';
import { exportarExcel } from '../../../../shared/utils/exportar-excel.util';
import { DateRangeFilter, RangoFecha } from '../../../../shared/ui/date-range-filter/date-range-filter';
import { Skeleton } from '../../../../shared/components/skeleton/skeleton';
import { JiraService } from '../../../../shared/services/jira.service';
import { ToastService } from '../../../../shared/services/toast.service';
import { Router } from '@angular/router';
import { Icon } from '../../../../shared/ui/icon/icon';

@Component({
  selector: 'app-tec-reportes-errores',
  imports: [DecimalPipe, DateRangeFilter, Skeleton, Icon],
  templateUrl: './reportes-errores.html',
  styleUrl: './reportes-errores.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TecReportesErrores implements OnInit {
  private service = inject(AppErrorReportsService);
  private jira = inject(JiraService);
  private toast = inject(ToastService);
  private router = inject(Router);

  readonly tipos = APP_ERROR_TYPES;

  // AW14 — crear un issue de Jira desde un reporte de error.
  creandoIssue = signal<string | null>(null);
  async crearIssue(reporteId: string) {
    if (this.creandoIssue()) return;
    this.creandoIssue.set(reporteId);
    try {
      await this.jira.crearDesdeReporte(reporteId);
      this.toast.success('Issue creado', 'Se creó un bug en el board de Issues.');
      void this.router.navigate(['/tecnologia/issues']);
    } catch (e: unknown) {
      this.toast.error('No se pudo crear el issue', e instanceof Error ? e.message : undefined);
    } finally {
      this.creandoIssue.set(null);
    }
  }

  // ── Vista: agrupado (por mensaje) / detalle (filas) ──
  vista = signal<'agrupado' | 'detalle'>('agrupado');

  // AW14 — bandeja (abiertos + en revisión) vs Historial (solucionados).
  estadoVista = signal<'abiertos' | 'solucionado'>('abiertos');

  // AW14 — drill-down de ocurrencias por firma (usuario + metadata).
  firmaExpandida = signal<string | null>(null);
  ocurrencias = signal<AppErrorOcurrencia[]>([]);
  cargandoOcurrencias = signal(false);
  marcando = signal<string | null>(null);

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
      // AW14 — solo en vista agrupada gatea por estado (bandeja/Historial).
      estado: this.vista() === 'agrupado' ? this.estadoVista() : null,
    };
  }

  /** AW14 — cambia entre bandeja de abiertos y Historial de solucionados. */
  cambiarEstadoVista(v: 'abiertos' | 'solucionado') {
    if (this.estadoVista() === v) return;
    this.estadoVista.set(v);
    this.firmaExpandida.set(null);
    void this.load();
  }

  /** AW14 — abre/cierra las ocurrencias de una firma (usuario + dispositivo + versión). */
  async verOcurrencias(g: AppErrorGrupo) {
    if (this.firmaExpandida() === g.firma) {
      this.firmaExpandida.set(null);
      return;
    }
    this.firmaExpandida.set(g.firma);
    this.cargandoOcurrencias.set(true);
    this.ocurrencias.set([]);
    try {
      this.ocurrencias.set(await this.service.getOcurrencias(g.firma));
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'Error al cargar ocurrencias.');
    } finally {
      this.cargandoOcurrencias.set(false);
    }
  }

  /** AW14 — marca el estado de atención de una firma (en revisión / solucionado / reabrir). */
  async marcar(g: AppErrorGrupo, estado: AppErrorEstado) {
    if (this.marcando()) return;
    // BI4 — al marcar SOLUCIONADO se pide la nota (qué lo cerró) y la versión del fix
    // (para que un cliente viejo no reabra el grupo). Ambas son opcionales pero útiles.
    let nota: string | null = null;
    let version: string | null = null;
    if (estado === 'solucionado') {
      nota = (prompt('¿Qué lo cerró? (p. ej. la migración o el cambio). Se guarda en el grupo:') ?? '').trim() || null;
      version = (prompt('¿En qué versión queda arreglado? (opcional; evita que un cliente viejo reabra el grupo)') ?? '').trim() || null;
    }
    this.marcando.set(g.firma);
    this.error.set('');
    try {
      await this.service.marcarEstado(g.firma, estado, nota, version);
      await this.load();
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'No se pudo actualizar el estado.');
    } finally {
      this.marcando.set(null);
    }
  }

  /** BI4 — crear un issue directamente desde un GRUPO (usa una ocurrencia de ejemplo). */
  async crearIssueDeGrupo(g: AppErrorGrupo) {
    if (!g.ejemplo_id) {
      this.toast.error('Sin ocurrencia de ejemplo', 'No se pudo identificar un reporte del grupo.');
      return;
    }
    await this.crearIssue(g.ejemplo_id);
  }

  estadoLabel(e: string): string {
    return e === 'en_revision' ? 'En revisión' : e === 'solucionado' ? 'Solucionado' : 'Abierto';
  }
  estadoBadgeClass(e: string): string {
    const base = 'sgc-badge ';
    if (e === 'solucionado') return base + 'sgc-badge--success';
    if (e === 'en_revision') return base + 'sgc-badge--info';
    return base + 'sgc-badge--warning';
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

  /** BI4 — el export sirve para TRIAR: exporta GRUPOS (firma, tipo, estado, conteos,
   *  primera/última vez, versión), no ocurrencias sueltas; sin tope de 500; respeta el
   *  filtro de estado (bandeja/Historial). Si el usuario está en vista detalle, exporta
   *  igual los grupos del filtro actual (que es lo útil para triar). */
  async exportar() {
    this.exportando.set(true);
    try {
      const grupos = await this.service.getGrupos(this.filtros());
      const filas = grupos.map((g) => ({
        Firma: g.firma,
        Tipo: this.tipoLabel(g.error_type),
        Plataforma: g.source ?? '',
        Estado: this.estadoLabel(g.estado),
        Ocurrencias: g.ocurrencias,
        'Clientes viejos': g.ocurrencias_cliente_viejo ?? 0,
        Dispositivos: g.dispositivos,
        Usuarios: g.usuarios,
        'Primera vez': this.formatTs(g.primera_vez),
        'Última vez': this.formatTs(g.ultima_vez),
        'Cerrado en versión': g.resuelto_en_version ?? '',
        Nota: g.nota ?? '',
        Ejemplo: g.ejemplo_message,
      }));
      await exportarExcel('reportes-errores-grupos', filas);
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'Error al exportar.');
    } finally {
      this.exportando.set(false);
    }
  }
}
