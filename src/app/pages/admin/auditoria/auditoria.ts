import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import {
  AuditoriaService,
  AuditoriaRow,
  AuditoriaActor,
  AuditoriaResumen,
} from '../../../../shared/services/auditoria.service';
import { formatTimestampDisplay } from '../../../../shared/utils/fecha.util';
import { BarChart, BarDatum } from '../../../../shared/ui/bar-chart/bar-chart';
import { DonutChart, DonutDatum } from '../../../../shared/ui/donut-chart/donut-chart';
import { Skeleton } from '../../../../shared/components/skeleton/skeleton';

const CAT = ['#1F4E79', '#2D7D46', '#B45309', '#5B3A8E', '#0E7490', '#C0392B', '#64748b'];

// Friendly Spanish labels for audited tables (module-oriented). Unknown tables
// fall back to the raw name so nothing is ever hidden.
const TABLA_LABELS: Record<string, string> = {
  salidas_inventario: 'Salida de inventario',
  detalle_salidas: 'Renglón de salida',
  entradas_inventario: 'Entrada de inventario',
  detalle_entradas: 'Renglón de entrada',
  articulos: 'Artículo',
  activos: 'Activo fijo',
  activos_fijos: 'Activo fijo',
  bodegas: 'Almacén',
  categorias_inventario: 'Categoría de inventario',
  conteos_inventario: 'Conteo de inventario',
  conteo_items: 'Renglón de conteo',
  unidades: 'Unidad de medida',
  ordenes_compra: 'Orden de compra',
  orden_compra_items: 'Renglón de orden de compra',
  proveedores: 'Proveedor',
  proyectos: 'Proyecto',
  empleados: 'Empleado',
  asistencia: 'Asistencia',
  bitacoras: 'Bitácora',
  bitacora_archivos: 'Archivo de bitácora',
  bitacora_catalogos: 'Catálogo de bitácora',
  bitacora_restricciones: 'Restricción de bitácora',
  bitacora_actividades: 'Actividad de bitácora',
  solicitudes_material: 'Requisición',
  solicitud_material_items: 'Renglón de solicitud',
  solicitudes_compra: 'Solicitud de compra',
  solicitud_compra_items: 'Renglón de solicitud de compra',
  vehiculos: 'Vehículo',
  vehiculo_entregas: 'Entrega de vehículo',
  vehiculo_entrega_fotos: 'Foto de entrega de vehículo',
  vehiculo_entrega_danos: 'Daño en entrega de vehículo',
  registros_combustible: 'Registro de combustible',
  conductores: 'Conductor',
  rutas: 'Ruta',
  mantenimientos: 'Mantenimiento',
  usuarios: 'Usuario',
  usuarios_roles: 'Rol de usuario',
  roles: 'Rol',
  tareas: 'Tarea',
  contratos: 'Contrato',
  expedientes_legales: 'Expediente legal',
  reportes_usuario: 'Reporte de usuario',
  weather_snapshots: 'Registro de clima',
};

const ACCION_LABELS: Record<string, string> = {
  INSERT: 'Creó',
  UPDATE: 'Modificó',
  DELETE: 'Eliminó',
};

/** Admin → Auditoría: browse the full change trail (who changed what, when).
 *  Reads sgc.auditoria (populated by DB triggers from BOTH web and app). */
@Component({
  selector: 'app-admin-auditoria',
  imports: [DecimalPipe, BarChart, DonutChart, Skeleton],
  templateUrl: './auditoria.html',
  styleUrl: './auditoria.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminAuditoria implements OnInit {
  private service = inject(AuditoriaService);

  formatTs = formatTimestampDisplay;

  /** W6 — vista activa: panel analítico o filas crudas (drill-down). */
  vista = signal<'panel' | 'filas'>('panel');
  resumen = signal<AuditoriaResumen | null>(null);
  resumenLoading = signal(false);

  rows = signal<AuditoriaRow[]>([]);
  total = signal(0);
  page = signal(0);
  loading = signal(true);
  error = signal('');
  expandedId = signal<number | null>(null);

  tablas = signal<string[]>([]);
  actores = signal<AuditoriaActor[]>([]);

  // Filters
  fTabla = signal('');
  fAccion = signal('');
  fActor = signal('');
  fDesde = signal('');
  fHasta = signal('');
  fBuscar = signal('');

  readonly pageSize = this.service.pageSize;
  totalPages = computed(() => Math.max(1, Math.ceil(this.total() / this.pageSize)));
  rangeLabel = computed(() => {
    if (this.total() === 0) return '0';
    const from = this.page() * this.pageSize + 1;
    const to = Math.min(this.total(), from + this.rows().length - 1);
    return `${from}–${to} de ${this.total()}`;
  });

  /** La lista de filas se carga perezosamente (la vista por defecto es el panel). */
  private filasCargadas = false;

  async ngOnInit() {
    // Vista por defecto = panel. Las filas crudas se cargan al entrar a esa pestaña.
    await Promise.all([this.loadResumen(), this.loadFilterOptions()]);
  }

  // ── W6 — Panel analítico ─────────────────────────────────────
  cambiarVista(v: 'panel' | 'filas') {
    this.vista.set(v);
    // Panel: siempre refresca los agregados para que reflejen el filtro actual.
    if (v === 'panel') void this.loadResumen();
    // Filas: carga perezosa la primera vez.
    if (v === 'filas' && !this.filasCargadas) void this.load();
  }

  async loadResumen() {
    this.resumenLoading.set(true);
    try {
      this.resumen.set(
        await this.service.resumen({
          desde: this.fDesde() || undefined,
          hasta: this.fHasta() || undefined,
          actorId: this.fActor() || undefined,
          tabla: this.fTabla() || undefined,
        }),
      );
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'Error al cargar el panel.');
    } finally {
      this.resumenLoading.set(false);
    }
  }

  // Charts derivados del resumen.
  rankingUsuarios = computed<BarDatum[]>(() =>
    (this.resumen()?.por_usuario ?? []).slice(0, 10).map((u, i) => ({
      label: u.nombre, value: u.n, color: CAT[i % CAT.length],
    })),
  );
  porModuloChart = computed<BarDatum[]>(() =>
    (this.resumen()?.por_modulo ?? []).slice(0, 10).map((m, i) => ({
      label: this.tablaLabel(m.tabla), value: m.n, color: CAT[i % CAT.length],
    })),
  );
  porAccionChart = computed<DonutDatum[]>(() => {
    const color: Record<string, string> = { INSERT: '#2D7D46', UPDATE: '#B45309', DELETE: '#C0392B' };
    return (this.resumen()?.por_accion ?? []).map((a) => ({
      label: this.accionLabel(a.accion), value: a.n, color: color[a.accion] ?? '#64748b',
    }));
  });
  porDiaChart = computed<BarDatum[]>(() =>
    (this.resumen()?.por_dia ?? []).map((d) => ({ label: d.dia.slice(5), value: d.n, color: '#1F4E79' })),
  );
  porHoraChart = computed<BarDatum[]>(() =>
    (this.resumen()?.por_hora ?? []).map((h) => ({ label: `${h.hora}h`, value: h.n, color: '#0E7490' })),
  );

  // Drill-down: salta a las filas crudas filtradas SOLO por la métrica elegida
  // (limpia los otros filtros; conserva el rango de fechas del período).
  private resetFiltrosSalvoFecha() {
    this.fActor.set('');
    this.fTabla.set('');
    this.fAccion.set('');
    this.fBuscar.set('');
  }
  verUsuario(actorId: string | null) {
    if (!actorId) return;
    this.resetFiltrosSalvoFecha();
    this.fActor.set(actorId);
    this.irAFilas();
  }
  verModulo(tabla: string) {
    this.resetFiltrosSalvoFecha();
    this.fTabla.set(tabla);
    this.irAFilas();
  }
  verAccionComun(tabla: string, accion: string) {
    this.resetFiltrosSalvoFecha();
    this.fTabla.set(tabla);
    this.fAccion.set(accion);
    this.irAFilas();
  }
  private irAFilas() {
    this.vista.set('filas');
    this.page.set(0);
    void this.load();
  }

  private async loadFilterOptions() {
    try {
      const [tablas, actores] = await Promise.all([this.service.tablas(), this.service.actores()]);
      this.tablas.set(tablas);
      this.actores.set(actores);
    } catch {
      /* filters are optional; ignore */
    }
  }

  async load() {
    this.filasCargadas = true;
    this.loading.set(true);
    this.error.set('');
    try {
      const { rows, total } = await this.service.list(
        {
          tabla: this.fTabla() || undefined,
          accion: this.fAccion() || undefined,
          actorId: this.fActor() || undefined,
          desde: this.fDesde() || undefined,
          hasta: this.fHasta() || undefined,
          buscar: this.fBuscar() || undefined,
        },
        this.page(),
      );
      this.rows.set(rows);
      this.total.set(total);
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'Error al cargar la auditoría.');
    } finally {
      this.loading.set(false);
    }
  }

  applyFilters() {
    this.page.set(0);
    void this.load();
    void this.loadResumen();
  }

  clearFilters() {
    this.fTabla.set('');
    this.fAccion.set('');
    this.fActor.set('');
    this.fDesde.set('');
    this.fHasta.set('');
    this.fBuscar.set('');
    this.applyFilters();
  }

  hasFilters = computed(
    () =>
      !!(this.fTabla() || this.fAccion() || this.fActor() || this.fDesde() || this.fHasta() || this.fBuscar()),
  );

  goToPage(p: number) {
    if (p < 0 || p >= this.totalPages()) return;
    this.page.set(p);
    void this.load();
  }

  toggle(id: number) {
    this.expandedId.update((cur) => (cur === id ? null : id));
  }

  tablaLabel(t: string): string {
    return TABLA_LABELS[t] ?? t;
  }
  accionLabel(a: string): string {
    return ACCION_LABELS[a] ?? a;
  }

  /** Changed fields for an UPDATE, as a display-friendly list. */
  cambiosList(row: AuditoriaRow): { campo: string; antes: string; despues: string }[] {
    if (!row.cambios) return [];
    return Object.entries(row.cambios).map(([campo, v]) => ({
      campo: this.humanizeCampo(campo),
      antes: this.fmt(v.antes),
      despues: this.fmt(v.despues),
    }));
  }

  /** Key fields of a created/deleted record. */
  datosList(row: AuditoriaRow): { campo: string; valor: string }[] {
    const data = row.datos_despues ?? row.datos_antes;
    if (!data) return [];
    return Object.entries(data)
      .filter(([, v]) => v !== null && v !== '' && typeof v !== 'object')
      .slice(0, 12)
      .map(([campo, v]) => ({ campo: this.humanizeCampo(campo), valor: this.fmt(v) }));
  }

  private humanizeCampo(c: string): string {
    return c.replace(/_/g, ' ').replace(/\bid\b/gi, 'ID');
  }

  private fmt(v: unknown): string {
    if (v === null || v === undefined) return '—';
    if (typeof v === 'boolean') return v ? 'Sí' : 'No';
    if (typeof v === 'object') return JSON.stringify(v);
    const s = String(v);
    return s.length > 80 ? s.slice(0, 80) + '…' : s;
  }
}
