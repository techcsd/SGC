import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { DecimalPipe, JsonPipe, UpperCasePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import {
  AuditoriaService,
  AuditoriaActor,
  AuditoriaResumen,
  AdminAccionRow,
  AuditoriaActividadFila,
  AuditoriaActividadFiltro,
} from '../../../../shared/services/auditoria.service';
import {
  formatTimestampDisplay,
  formatHoraTimestamp,
  formatFechaHumanaConSegundos,
  etiquetaDiaAgrupador,
} from '../../../../shared/utils/fecha.util';
import { exportarExcel } from '../../../../shared/utils/exportar-excel.util';
import { BarChart, BarDatum } from '../../../../shared/ui/bar-chart/bar-chart';
import { DateRangeFilter, RangoFecha } from '../../../../shared/ui/date-range-filter/date-range-filter';
import { DonutChart, DonutDatum } from '../../../../shared/ui/donut-chart/donut-chart';
import { FilterSelect, FilterOption } from '../../../../shared/ui/filter-select/filter-select';
import { Skeleton } from '../../../../shared/components/skeleton/skeleton';
import { Icon } from '../../../../shared/ui/icon/icon';
import { TranslatePipe } from '../../../../shared/i18n/translate.pipe';

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

// AZ10 — etiquetas legibles de las acciones de administración (audit_log).
const ADMIN_ACCION_LABELS: Record<string, string> = {
  impersonacion_inicio: 'Entró como usuario (soporte)',
  impersonacion_fin: 'Salió de la sesión de soporte',
  usuario_test_login: 'Entró como usuario de prueba',
  usuario_test_creado: 'Creó usuario de prueba',
  usuario_marcado_prueba: 'Marcó usuario como prueba',
  usuario_desmarcado_prueba: 'Quitó marca de prueba',
  roles_actualizados: 'Actualizó roles',
  rol_eliminado: 'Eliminó rol',
  usuario_creado: 'Creó usuario',
  usuario_actualizado: 'Actualizó usuario',
  usuario_desactivado: 'Desactivó usuario',
  usuario_reactivado: 'Reactivó usuario',
  usuario_eliminado: 'Eliminó usuario',
  invitacion_reenviada: 'Reenvió invitación',
  password_reset_solicitado: 'Solicitó restablecer contraseña',
  password_reset_rechazado_sintetico: 'Intentó restablecer contraseña de un usuario sin correo',
  mi_perfil_actualizado: 'Actualizó su perfil',
  // BI6 — credenciales de campo (cédula + PIN)
  credencial_acceso_creado: 'Creó acceso de campo (cédula + PIN)',
  credencial_pin_rotado: 'Fijó/rotó el PIN de un usuario',
  credencial_email_resync: 'Resincronizó el correo de acceso por cédula',
};

// CQ3 — a dónde enlazar un registro desde el panel de detalle. Solo las tablas
// donde estamos SEGUROS de la ruta real (grep de app.routes.ts/*.routes.ts); si
// no hay certeza, se omite el link (no se inventan rutas — regla 10/16).
const RUTA_REGISTRO: Record<string, (id: string) => string> = {
  solicitudes_material: (id) => `/inventario/requisiciones?req=${id}`,
  vehiculos: (id) => `/flota/vehiculos/${id}`,
  conductores: (id) => `/flota/conductores/${id}`,
  proyectos: (id) => `/proyectos/${id}`,
};

// CQ3 — campos cuyo valor es el id de un usuario (para best-effort resolver su
// nombre en el panel de detalle, usando el directorio de actores ya cargado).
// Si el id no está en ese directorio (nunca actuó en el log) se muestra crudo —
// no se bloquea nada por esto (regla 16: nunca tumbar la pantalla).
const CAMPOS_USUARIO = new Set([
  'actor_id', 'solicitante_id', 'atendido_por', 'aprobador_id', 'decidida_por',
  'cerrada_por', 'asignado_por', 'responsable_id', 'usuario_id', 'creado_por',
]);

const CAMPO_LABELS: Record<string, string> = {
  estado: 'Estado', activo: 'Activo', monto: 'Monto', cantidad: 'Cantidad',
  folio: 'Folio', nombre: 'Nombre', placa: 'Placa', cedula: 'Cédula', email: 'Correo',
  notas: 'Notas', urgencia: 'Urgencia', bodega_id: 'Almacén', proyecto_id: 'Proyecto',
  motivo_rechazo: 'Motivo de rechazo', fecha_necesidad: 'Fecha necesaria',
  autoaprobada: 'Autoaprobada', numero: 'Número', unidad: 'Unidad',
};

/** CQ3 — un día de la línea de tiempo de Actividad (encabezado + sus filas). */
interface GrupoDia {
  clave: string;
  etiqueta: string;
  filas: AuditoriaActividadFila[];
}

/** Admin → Auditoría: browse the full change trail (who changed what, when).
 *  Reads sgc.auditoria (populated by DB triggers from BOTH web and app).
 *  CQ3 — 3 pestañas: Actividad (línea de tiempo legible, por defecto) /
 *  Resumen (panel analítico) / Acciones de admin (audit_log). */
@Component({
  selector: 'app-admin-auditoria',
  imports: [DecimalPipe, JsonPipe, UpperCasePipe, RouterLink, BarChart, DonutChart, Skeleton, DateRangeFilter, FilterSelect, Icon, TranslatePipe],
  templateUrl: './auditoria.html',
  styleUrl: './auditoria.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminAuditoria implements OnInit {
  private service = inject(AuditoriaService);

  formatTs = formatTimestampDisplay;
  formatHora = formatHoraTimestamp;
  formatPreciso = formatFechaHumanaConSegundos;

  /** CQ3 — vista activa: Actividad (por defecto) / Resumen (panel analítico) / Acciones de admin. */
  vista = signal<'actividad' | 'resumen' | 'admin'>('actividad');

  // ── CQ3 — Actividad (línea de tiempo) ─────────────────────────────────────
  actFilas = signal<AuditoriaActividadFila[]>([]);
  actCursor = signal<string | null>(null);
  actHayMas = signal(false);
  actLoading = signal(true);
  actLoadingMas = signal(false);
  actError = signal('');

  actTexto = signal('');
  actPersona = signal(''); // actor_id
  actModulo = signal('');
  actAccion = signal('');
  actDesde = signal('');
  actHasta = signal('');

  /** Fila elegida para el panel de detalle (null = panel cerrado). */
  seleccion = signal<AuditoriaActividadFila | null>(null);
  /** true = el panel muestra la historia COMPLETA del registro (todas las acciones,
   *  todos los usuarios), no solo la fila clicada. */
  historiaModo = signal(false);
  historiaFilas = signal<AuditoriaActividadFila[]>([]);
  historiaLoading = signal(false);
  verJson = signal(false);

  private actCargado = false;

  personaOptions = computed<FilterOption[]>(() => this.actores().map((a) => ({ value: a.actor_id, label: a.nombre })));
  moduloOptions = computed<FilterOption[]>(() =>
    this.tablas().map((t) => ({ value: t, label: this.tablaLabel(t) })).sort((a, b) => a.label.localeCompare(b.label)),
  );
  accionOptions: FilterOption[] = [
    { value: 'INSERT', label: 'Creó' },
    { value: 'UPDATE', label: 'Modificó' },
    { value: 'DELETE', label: 'Eliminó' },
  ];
  personaChipLabel = computed(() => this.actores().find((a) => a.actor_id === this.actPersona())?.nombre ?? '');

  actHasFilters = computed(
    () => !!(this.actTexto() || this.actPersona() || this.actModulo() || this.actAccion() || this.actDesde() || this.actHasta()),
  );

  /** Filas agrupadas por día (Hoy / Ayer / "Jueves 16 oct"), en el orden en que llegan (desc). */
  gruposPorDia = computed<GrupoDia[]>(() => {
    const out: GrupoDia[] = [];
    const idx = new Map<string, number>();
    for (const f of this.actFilas()) {
      const d = new Date(f.creado_en);
      const clave = isNaN(d.getTime()) ? '—' : `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      let i = idx.get(clave);
      if (i === undefined) {
        i = out.length;
        idx.set(clave, i);
        out.push({ clave, etiqueta: etiquetaDiaAgrupador(f.creado_en), filas: [] });
      }
      out[i].filas.push(f);
    }
    return out;
  });

  // AZ10 — acciones de administración (audit_log): impersonación, roles, usuarios test.
  adminRows = signal<AdminAccionRow[]>([]);
  adminTotal = signal(0);
  adminPage = signal(0);
  adminLoading = signal(false);
  fAdminAccion = signal('');
  private adminCargado = false;
  adminTotalPages = computed(() => Math.max(1, Math.ceil(this.adminTotal() / this.pageSize)));
  resumen = signal<AuditoriaResumen | null>(null);
  resumenLoading = signal(false);

  // CQ3 — Resumen ahora filtra SOLO por rango de fecha (es un panel analítico
  // agregado; filtrar también por persona/módulo no aportaba y complicaba la UI).
  rDesde = signal('');
  rHasta = signal('');

  tablas = signal<string[]>([]);
  actores = signal<AuditoriaActor[]>([]);

  readonly pageSize = this.service.pageSize;

  async ngOnInit() {
    await this.loadFilterOptions();
    await this.loadActividad(true);
  }

  cambiarVista(v: 'actividad' | 'resumen' | 'admin') {
    this.vista.set(v);
    if (v === 'actividad' && !this.actCargado) void this.loadActividad(true);
    if (v === 'resumen') void this.loadResumen();
    if (v === 'admin' && !this.adminCargado) void this.loadAdmin();
  }

  // ── CQ3 — Actividad ────────────────────────────────────────────────────────
  private async loadFilterOptions() {
    try {
      const { tablas, actores } = await this.service.opciones();
      this.tablas.set(tablas);
      this.actores.set(actores);
    } catch (e: unknown) {
      this.actError.set(e instanceof Error ? e.message : 'No se pudieron cargar los filtros.');
    }
  }

  private filtroActividad(): AuditoriaActividadFiltro {
    return {
      persona: this.actPersona() || undefined,
      texto: this.actTexto() || undefined,
      desde: this.actDesde() || undefined,
      hasta: this.actHasta() || undefined,
      modulo: this.actModulo() || undefined,
      accion: this.actAccion() || undefined,
    };
  }

  async loadActividad(reset: boolean) {
    this.actCargado = true;
    if (reset) {
      this.actLoading.set(true);
      this.actCursor.set(null);
    } else {
      this.actLoadingMas.set(true);
    }
    this.actError.set('');
    try {
      const { filas, cursorSiguiente, hayMas } = await this.service.actividad(
        this.filtroActividad(),
        reset ? null : this.actCursor(),
      );
      this.actFilas.update((cur) => (reset ? filas : [...cur, ...filas]));
      this.actCursor.set(cursorSiguiente);
      this.actHayMas.set(hayMas);
    } catch (e: unknown) {
      this.actError.set(e instanceof Error ? e.message : 'Error al cargar la actividad.');
    } finally {
      this.actLoading.set(false);
      this.actLoadingMas.set(false);
    }
  }

  cargarMasActividad() {
    if (this.actHayMas() && !this.actLoadingMas()) void this.loadActividad(false);
  }

  aplicarFiltrosActividad() {
    void this.loadActividad(true);
  }

  onBuscarEnter(ev: Event) {
    ev.preventDefault();
    this.aplicarFiltrosActividad();
  }

  onRangoActividad(r: RangoFecha) {
    this.actDesde.set(r.desde ?? '');
    this.actHasta.set(r.hasta ?? '');
    this.aplicarFiltrosActividad();
  }

  limpiarFiltrosActividad() {
    this.actTexto.set('');
    this.actPersona.set('');
    this.actModulo.set('');
    this.actAccion.set('');
    this.actDesde.set('');
    this.actHasta.set('');
    this.aplicarFiltrosActividad();
  }

  /** Clic en el nombre de una persona dentro de una fila → filtra por ella. */
  filtrarPorPersona(actorId: string | null) {
    if (!actorId) return;
    this.actPersona.set(actorId);
    this.aplicarFiltrosActividad();
  }

  quitarFiltroPersona() {
    this.actPersona.set('');
    this.aplicarFiltrosActividad();
  }

  /** Clic en una fila → panel de detalle (solo esa fila). */
  seleccionar(f: AuditoriaActividadFila) {
    this.seleccion.set(f);
    this.historiaModo.set(false);
    this.historiaFilas.set([]);
    this.verJson.set(false);
  }

  cerrarDetalle() {
    this.seleccion.set(null);
    this.historiaModo.set(false);
  }

  /** "Ver toda la historia de {código}" → trae TODAS las acciones del registro. */
  async verHistoriaCompleta(f: AuditoriaActividadFila) {
    this.seleccion.set(f);
    this.historiaModo.set(true);
    this.historiaLoading.set(true);
    try {
      this.historiaFilas.set(await this.service.historiaRegistro(f.tabla, f.registro_id));
    } catch (e: unknown) {
      this.actError.set(e instanceof Error ? e.message : 'Error al cargar la historia del registro.');
    } finally {
      this.historiaLoading.set(false);
    }
  }

  /** Ruta real para "abrir" el registro desde el detalle, si se conoce (regla 10/16: nunca inventar). */
  rutaRegistro(f: AuditoriaActividadFila): string | null {
    return RUTA_REGISTRO[f.tabla]?.(f.registro_id) ?? null;
  }

  /** Campo→valor "antes/después" SOLO de lo que cambió, con nombres legibles y
   *  resolución best-effort de ids de usuario conocidos (regla AT11). */
  cambiosDetalle(f: AuditoriaActividadFila): { campo: string; antes: string; despues: string }[] {
    if (!f.cambios) return [];
    return Object.entries(f.cambios).map(([campo, v]) => ({
      campo: this.campoLabel(campo),
      antes: this.fmtValor(campo, v.antes),
      despues: this.fmtValor(campo, v.despues),
    }));
  }

  campoLabel(c: string): string {
    return CAMPO_LABELS[c] ?? c.replace(/_/g, ' ').replace(/\bid\b/gi, 'ID');
  }

  private usuarioNombre(id: unknown): string | null {
    if (typeof id !== 'string') return null;
    return this.actores().find((a) => a.actor_id === id)?.nombre ?? null;
  }

  private fmtValor(campo: string, v: unknown): string {
    if (v === null || v === undefined) return '—';
    if (typeof v === 'boolean') return v ? 'Sí' : 'No';
    if (CAMPOS_USUARIO.has(campo)) {
      const nombre = this.usuarioNombre(v);
      if (nombre) return nombre;
    }
    const s = String(v);
    return s.length > 80 ? s.slice(0, 80) + '…' : s;
  }

  exportando = signal(false);

  /** Exporta a Excel TODO lo que coincide con el filtro actual de Actividad,
   *  recorriendo el cursor hasta agotarlo (con un tope de seguridad). */
  async exportarActividad() {
    if (this.exportando()) return;
    this.exportando.set(true);
    try {
      const filtro = this.filtroActividad();
      const todas: AuditoriaActividadFila[] = [];
      let cursor: string | null = null;
      const MAX_PAGINAS = 250; // ~10k filas con pageSize=40
      for (let i = 0; i < MAX_PAGINAS; i++) {
        const { filas, cursorSiguiente, hayMas } = await this.service.actividad(filtro, cursor);
        todas.push(...filas);
        if (!hayMas || filas.length === 0) break;
        cursor = cursorSiguiente;
      }
      const filas = todas.map((r) => ({
        'Fecha y hora': this.formatTs(r.creado_en),
        Usuario: r.actor_nombre ?? 'Sistema',
        Acción: this.accionLabel(r.accion),
        Área: this.tablaLabel(r.tabla),
        Registro: r.codigo ?? r.registro_id,
        Qué: r.frase_resumen,
        'Qué cambió': r.resumen_cambio ?? '',
        Desde: r.origen ?? 'No disponible',
      }));
      await exportarExcel('auditoria-actividad', filas);
    } catch (e: unknown) {
      this.actError.set(e instanceof Error ? e.message : 'Error al exportar la auditoría.');
    } finally {
      this.exportando.set(false);
    }
  }

  // ── Resumen (panel analítico) ───────────────────────────────────────────────
  async loadResumen() {
    this.resumenLoading.set(true);
    try {
      this.resumen.set(await this.service.resumen({ desde: this.rDesde() || undefined, hasta: this.rHasta() || undefined }));
    } catch (e: unknown) {
      this.actError.set(e instanceof Error ? e.message : 'Error al cargar el panel.');
    } finally {
      this.resumenLoading.set(false);
    }
  }

  onRangoResumen(r: RangoFecha) {
    this.rDesde.set(r.desde ?? '');
    this.rHasta.set(r.hasta ?? '');
    void this.loadResumen();
  }

  // Y2 — listas drill-down con top-N + "Ver más" (presentación).
  readonly DRILL_TOP = 6;
  expandU = signal(false);
  expandA = signal(false);
  expandM = signal(false);
  usuariosDrill = computed(() => {
    const l = this.resumen()?.por_usuario ?? [];
    return this.expandU() ? l : l.slice(0, this.DRILL_TOP);
  });
  accionesDrill = computed(() => {
    const l = this.resumen()?.acciones_comunes ?? [];
    return this.expandA() ? l : l.slice(0, this.DRILL_TOP);
  });
  modulosDrill = computed(() => {
    const l = this.resumen()?.por_modulo ?? [];
    return this.expandM() ? l : l.slice(0, this.DRILL_TOP);
  });

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

  // Drill-down: salta a Actividad filtrada SOLO por la métrica elegida (conserva
  // el rango de fechas del período del Resumen).
  verUsuario(actorId: string | null) {
    if (!actorId) return;
    this.limpiarFiltrosActividadSalvoFecha();
    this.actPersona.set(actorId);
    this.irAActividad();
  }
  verModulo(tabla: string) {
    this.limpiarFiltrosActividadSalvoFecha();
    this.actModulo.set(tabla);
    this.irAActividad();
  }
  verAccionComun(tabla: string, accion: string) {
    this.limpiarFiltrosActividadSalvoFecha();
    this.actModulo.set(tabla);
    this.actAccion.set(accion);
    this.irAActividad();
  }
  private limpiarFiltrosActividadSalvoFecha() {
    this.actTexto.set('');
    this.actPersona.set('');
    this.actModulo.set('');
    this.actAccion.set('');
    this.actDesde.set(this.rDesde());
    this.actHasta.set(this.rHasta());
  }
  private irAActividad() {
    this.vista.set('actividad');
    void this.loadActividad(true);
  }

  // ── AZ10 — Acciones de administración ─────────────────────────────────────
  async loadAdmin() {
    this.adminCargado = true;
    this.adminLoading.set(true);
    this.actError.set('');
    try {
      const { rows, total } = await this.service.listAdmin(this.adminPage(), this.fAdminAccion() || undefined);
      this.adminRows.set(rows);
      this.adminTotal.set(total);
    } catch (e: unknown) {
      this.actError.set(e instanceof Error ? e.message : 'Error al cargar las acciones de administración.');
    } finally {
      this.adminLoading.set(false);
    }
  }

  adminApplyFilter() {
    this.adminPage.set(0);
    void this.loadAdmin();
  }

  adminGoToPage(p: number) {
    if (p < 0 || p >= this.adminTotalPages()) return;
    this.adminPage.set(p);
    void this.loadAdmin();
  }

  adminAccionLabel(a: string): string {
    return ADMIN_ACCION_LABELS[a] ?? a;
  }

  /** Texto de detalle de una acción de admin (metadata → frase corta). */
  adminDetalle(r: AdminAccionRow): string {
    const m = r.metadata ?? {};
    const parts: string[] = [];
    if (r.target_nombre) parts.push(`sobre ${r.target_nombre}`);
    else if (m['nombre']) parts.push(`sobre ${m['nombre']}`);
    if (m['email']) parts.push(String(m['email']));
    return parts.join(' · ');
  }

  tablaLabel(t: string): string {
    return TABLA_LABELS[t] ?? t;
  }
  accionLabel(a: string): string {
    return ACCION_LABELS[a] ?? a;
  }

  // Compat: el error visible de la pantalla (cualquier pestaña escribe aquí).
  get error() {
    return this.actError;
  }
}
