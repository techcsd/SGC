import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import {
  AuditoriaService,
  AuditoriaRow,
  AuditoriaActor,
} from '../../../../shared/services/auditoria.service';
import { formatTimestampDisplay } from '../../../../shared/utils/fecha.util';

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
  detalle_ordenes_compra: 'Renglón de orden',
  proveedores: 'Proveedor',
  proyectos: 'Proyecto',
  empleados: 'Empleado',
  asistencia: 'Asistencia',
  bitacoras: 'Bitácora',
  bitacora_archivos: 'Archivo de bitácora',
  bitacora_catalogos: 'Catálogo de bitácora',
  solicitudes_material: 'Requisición',
  solicitud_material_items: 'Renglón de solicitud',
  solicitudes_compra: 'Solicitud de compra',
  vehiculos: 'Vehículo',
  vehiculo_entregas: 'Entrega de vehículo',
  conductores: 'Conductor',
  rutas: 'Ruta',
  mantenimientos: 'Mantenimiento',
  usuarios: 'Usuario',
  usuarios_roles: 'Rol de usuario',
  roles: 'Rol',
  tareas: 'Tarea',
  contratos: 'Contrato',
  expedientes: 'Expediente legal',
  reportes_usuario: 'Reporte de usuario',
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
  imports: [],
  templateUrl: './auditoria.html',
  styleUrl: './auditoria.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminAuditoria implements OnInit {
  private service = inject(AuditoriaService);

  formatTs = formatTimestampDisplay;

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

  async ngOnInit() {
    await Promise.all([this.load(), this.loadFilterOptions()]);
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
