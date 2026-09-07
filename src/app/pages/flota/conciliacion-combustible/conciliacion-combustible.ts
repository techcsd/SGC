import { Component, ChangeDetectionStrategy, inject, signal, computed, OnInit } from '@angular/core';
import { FlotaSubnav } from '../flota-subnav/flota-subnav';
import { DecimalPipe } from '@angular/common';
import {
  CombustibleConciliacionService,
  ConciliacionRegistro,
  ConciliacionDetalle,
  ConciliacionMeta,
  InformeRow,
  TarjetaMap,
} from '../../../../shared/services/combustible-conciliacion.service';
import { parseTotalEnergiesPdfFull, TotalEnergiesCard } from '../../../../shared/utils/parse-pdf-totalenergies.util';
import { VehiculosService } from '../../../../shared/services/vehiculos.service';
import { EstacionesCombustibleService, EstacionCombustible } from '../../../../shared/services/estaciones-combustible.service';
import { ToastService } from '../../../../shared/services/toast.service';
import { Skeleton } from '../../../../shared/components/skeleton/skeleton';
import { DateRangeFilter, RangoFecha } from '../../../../shared/ui/date-range-filter/date-range-filter';
import { formatFechaDisplay } from '../../../../shared/utils/fecha.util';
import { exportarExcel } from '../../../../shared/utils/exportar-excel.util';
import { Icon } from '../../../../shared/ui/icon/icon';

// Tolerancias de matching.
const DIAS_TOLERANCIA = 2;
const GAL_TOLERANCIA = 0.5;
const MONTO_TOLERANCIA = 50;

/**
 * T4 — Conciliación de combustible: importa el informe de la estación (Excel/CSV
 * tolerante a columnas), lo cruza con los registros de la plataforma y muestra
 * matches, diferencias y faltantes en ambos lados. Guarda la conciliación y
 * notifica discrepancias. Solo roles elevados de flota.
 */
@Component({
  selector: 'app-conciliacion-combustible',
  imports: [FlotaSubnav, DecimalPipe, Skeleton, DateRangeFilter, Icon],
  templateUrl: './conciliacion-combustible.html',
  styleUrl: './conciliacion-combustible.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConciliacionCombustible implements OnInit {
  private service = inject(CombustibleConciliacionService);
  private estacionesService = inject(EstacionesCombustibleService);
  private vehiculosService = inject(VehiculosService);
  private toast = inject(ToastService);

  formatFecha = formatFechaDisplay;

  estaciones = signal<EstacionCombustible[]>([]);
  estacionSel = signal('Total Energies');
  historial = signal<ConciliacionRegistro[]>([]);
  loadingHist = signal(true);

  nombreArchivo = signal<string | null>(null);
  parsing = signal(false);
  saving = signal(false);
  parseError = signal('');

  // Z23 — preview obligatorio antes de conciliar/insertar.
  preview = signal<InformeRow[] | null>(null);
  facturaNum = signal('');
  facturaTotal = signal<number | null>(null);
  importando = signal(false);

  // ── BJ2 — mapeo tarjeta→vehículo/persona (solo cuando el origen es el PDF) ────
  esPdfPreview = signal(false);
  /** Tarjetas detectadas en el PDF con su vehículo asignado (editable). */
  cardsDetectadas = signal<{ card: TotalEnergiesCard; vehiculo_id: string | null; guardando?: boolean }[]>([]);
  /** Catálogo de vehículos activos para el selector de mapeo. */
  vehiculos = signal<{ id: string; label: string; placa: string }[]>([]);
  private tarjetaMap = new Map<string, TarjetaMap>();
  /** BJ2 — factura PDF original (se sube al guardar la conciliación). */
  private archivoPdf: File | null = null;
  /** BJ2 — resumen por producto del PDF (para el cuadre). */
  productosDetectados = signal<{ nombre: string; cantidad: number | null; monto: number | null }[]>([]);
  /** Cuántas tarjetas del PDF siguen sin vehículo (caerían en «solo informe»). */
  tarjetasSinMapear = computed(() =>
    this.cardsDetectadas().filter((c) => !c.vehiculo_id).length,
  );
  previewStats = computed(() => {
    const rows = this.preview() ?? [];
    // BB7 — una fila cuenta como "válida a importar" si no es inválida, ni duplicada,
    // ni fue excluida a mano por el usuario.
    const validas = rows.filter((r) => !r.invalida && !r.duplicada && !r.excluida);
    return {
      total: rows.length,
      validas: validas.length,
      duplicadas: rows.filter((r) => r.duplicada).length,
      invalidas: rows.filter((r) => r.invalida).length,
      excluidas: rows.filter((r) => r.excluida && !r.invalida && !r.duplicada).length,
      personas: rows.filter((r) => r.titular_es_persona).length,
      sumaGalones: validas.reduce((s, r) => s + (r.galones ?? 0), 0),
      sumaMonto: validas.reduce((s, r) => s + (r.monto ?? 0), 0),
    };
  });

  /** BB7 — texto legible del motivo de una fila inválida/duplicada (tooltip/columna). */
  motivoTexto(r: InformeRow): string {
    return (r.motivos ?? []).join(' · ');
  }

  /** BB7 — excluir/incluir conscientemente una fila del import (nunca un callejón). */
  toggleExcluir(r: InformeRow) {
    const rows = this.preview();
    if (!rows) return;
    this.preview.set(rows.map((x) => (x === r ? { ...x, excluida: !x.excluida } : x)));
  }
  /** ¿La suma de montos cuadra con el total de la factura (±1)? */
  cuadraFactura = computed(() => {
    const t = this.facturaTotal();
    if (t == null) return null;
    return Math.abs(this.previewStats().sumaMonto - t) <= 1;
  });

  /** Detalles resultantes del último cruce (en memoria, aún sin guardar). */
  detalles = signal<ConciliacionDetalle[]>([]);
  meta = signal<ConciliacionMeta | null>(null);
  /** Pestaña activa del resultado. */
  tab = signal<'diferencia' | 'solo_plataforma' | 'solo_informe' | 'match'>('diferencia');

  detallesPorTab = computed(() => this.detalles().filter((d) => d.tipo === this.tab()));

  // ── Z23.3 — Filtros del detalle (por vehículo/tarjeta y rango de fecha) ──────
  filtroVehiculo = signal('');
  filtroDesde = signal('');
  filtroHasta = signal('');

  /** Identificadores (placa/tarjeta) presentes en la pestaña activa, para el select. */
  identificadoresDisponibles = computed(() => {
    const set = new Set<string>();
    for (const d of this.detallesPorTab()) {
      if (d.identificador) set.add(d.identificador);
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  });

  /** Filas visibles = pestaña activa + filtro de vehículo/tarjeta + rango de fecha. */
  detallesFiltrados = computed(() => {
    const veh = this.filtroVehiculo();
    const desde = this.filtroDesde();
    const hasta = this.filtroHasta();
    return this.detallesPorTab().filter((d) => {
      if (veh && d.identificador !== veh) return false;
      if (desde && (!d.fecha || d.fecha < desde)) return false;
      if (hasta && (!d.fecha || d.fecha > hasta)) return false;
      return true;
    });
  });

  hayFiltrosDetalle = computed(() => !!(this.filtroVehiculo() || this.filtroDesde() || this.filtroHasta()));

  onFiltroVehiculo(v: string) { this.filtroVehiculo.set(v); }
  onRangoDetalle(r: RangoFecha) { this.filtroDesde.set(r.desde ?? ''); this.filtroHasta.set(r.hasta ?? ''); }
  limpiarFiltrosDetalle() { this.filtroVehiculo.set(''); this.filtroDesde.set(''); this.filtroHasta.set(''); }

  discrepancias = computed(() => {
    const m = this.meta();
    if (!m) return 0;
    return m.total_diferencias + m.total_solo_plataforma + m.total_solo_informe;
  });

  // ── Dashboard: agregados por mes del historial guardado ──────────────
  dashboardMeses = computed(() => {
    const map = new Map<string, { mes: string; plataforma: number; informe: number; discrepancias: number }>();
    for (const c of this.historial()) {
      const mes = (c.fecha_hasta ?? c.created_at).slice(0, 7);
      const g = map.get(mes) ?? { mes, plataforma: 0, informe: 0, discrepancias: 0 };
      g.plataforma += Number(c.monto_plataforma) || 0;
      g.informe += Number(c.monto_informe) || 0;
      g.discrepancias += (c.total_diferencias || 0) + (c.total_solo_plataforma || 0) + (c.total_solo_informe || 0);
      map.set(mes, g);
    }
    return [...map.values()].sort((a, b) => b.mes.localeCompare(a.mes));
  });

  totalDiscrepanciasHist = computed(() =>
    this.historial().reduce(
      (s, c) => s + (c.total_diferencias || 0) + (c.total_solo_plataforma || 0) + (c.total_solo_informe || 0),
      0,
    ),
  );
  pctMatchHist = computed(() => {
    const filas = this.historial().reduce((s, c) => s + (c.total_informe_filas || 0), 0);
    const matches = this.historial().reduce((s, c) => s + (c.total_matches || 0), 0);
    return filas > 0 ? Math.round((matches / filas) * 100) : null;
  });

  async ngOnInit() {
    try {
      this.estaciones.set(await this.estacionesService.getActivas());
    } catch {
      /* catálogo opcional */
    }
    try {
      const vs = await this.vehiculosService.getAll();
      this.vehiculos.set(
        (vs ?? [])
          .filter((v) => v.activo !== false && !!v.placa)
          .map((v) => ({
            id: v.id,
            placa: v.placa as string,
            label: [v.placa, v.marca, v.modelo].filter(Boolean).join(' · '),
          }))
          .sort((a, b) => a.label.localeCompare(b.label)),
      );
    } catch {
      /* el mapeo puede quedarse sin catálogo; no bloquea */
    }
    await this.cargarHistorial();
  }

  private async cargarHistorial() {
    this.loadingHist.set(true);
    try {
      this.historial.set(await this.service.getHistorial());
    } catch {
      /* no bloquea */
    } finally {
      this.loadingHist.set(false);
    }
  }

  onEstacion(value: string) {
    this.estacionSel.set(value);
  }

  /** Z23 — Importa el archivo y muestra el PREVIEW (no inserta/concilia aún). */
  async onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.parseError.set('');
    this.parsing.set(true);
    this.nombreArchivo.set(file.name);
    this.preview.set(null);
    this.detalles.set([]);
    this.meta.set(null);
    try {
      // BJ2 — el reporte puede venir como Excel/CSV (SheetJS) o como la FACTURA PDF
      // de TotalEnergies (crédito fiscal electrónico). El PDF produce el mismo
      // InformeRow[] → el matcher y el import no cambian.
      const esPdf = /\.pdf$/i.test(file.name) || file.type === 'application/pdf';
      this.esPdfPreview.set(esPdf);
      this.cardsDetectadas.set([]);
      this.productosDetectados.set([]);
      this.archivoPdf = esPdf ? file : null;
      let filas: InformeRow[];
      let cards: TotalEnergiesCard[] = [];
      if (esPdf) {
        const parsed = await parseTotalEnergiesPdfFull(new Uint8Array(await file.arrayBuffer()));
        filas = parsed.rows;
        cards = parsed.cards;
        this.productosDetectados.set(parsed.productos);
      } else {
        filas = await this.parseInforme(file);
      }
      if (filas.length === 0) {
        this.parseError.set(
          esPdf
            ? 'No se detectaron transacciones en el PDF. ¿Es la factura de consumo de TotalEnergies?'
            : 'No se detectaron filas válidas en el archivo. Verifica que sea el reporte del proveedor.',
        );
        return;
      }
      // Dedupe: marca las transacciones ya importadas.
      const nums = filas.map((f) => f.transaccion_num).filter(Boolean);
      const existentes = new Set(await this.service.transaccionesExistentes(nums));
      for (const f of filas) {
        if (f.transaccion_num && existentes.has(f.transaccion_num)) {
          f.duplicada = true;
          (f.motivos ??= []).push(`ya importada (transacción ${f.transaccion_num})`);
        }
      }
      this.facturaNum.set(filas.find((f) => f.numero_factura)?.numero_factura ?? '');
      this.facturaTotal.set(filas.find((f) => f.total_factura != null)?.total_factura ?? null);
      // BJ2 — para el PDF: carga el mapeo aprendido y resuelve tarjeta→vehículo.
      if (esPdf) await this.prepararMapeoTarjetas(cards, filas);
      this.preview.set(filas);
    } catch (e: unknown) {
      this.parseError.set(e instanceof Error ? e.message : 'No se pudo leer el archivo.');
    } finally {
      this.parsing.set(false);
    }
  }

  cancelarPreview() {
    this.preview.set(null);
    this.nombreArchivo.set(null);
    this.parseError.set('');
    this.esPdfPreview.set(false);
    this.cardsDetectadas.set([]);
    this.productosDetectados.set([]);
    this.archivoPdf = null;
  }

  /** BJ2 — carga el mapeo aprendido, lo aplica a las filas (tarjeta→placa) y arma
   *  el panel de tarjetas detectadas para que el usuario complete lo que falte. */
  private async prepararMapeoTarjetas(cards: TotalEnergiesCard[], filas: InformeRow[]) {
    try {
      const mapa = await this.service.getTarjetaMap();
      this.tarjetaMap = new Map(mapa.map((m) => [m.codigo_tarjeta, m]));
    } catch {
      this.tarjetaMap = new Map();
    }
    this.aplicarMapeoAFilas(filas);
    // Tarjetas únicas del PDF (por si el parser repite), con su vehículo actual.
    const vistos = new Set<string>();
    const lista: { card: TotalEnergiesCard; vehiculo_id: string | null }[] = [];
    for (const c of cards) {
      if (!c.codigo || vistos.has(c.codigo)) continue;
      vistos.add(c.codigo);
      lista.push({ card: c, vehiculo_id: this.tarjetaMap.get(c.codigo)?.vehiculo_id ?? null });
    }
    this.cardsDetectadas.set(lista);
  }

  /** Aplica el mapeo actual: si la tarjeta tiene vehículo, el identificador de sus
   *  filas pasa a ser la placa → el matcher (por placa) las cruza. */
  private aplicarMapeoAFilas(filas: InformeRow[]) {
    for (const f of filas) {
      const m = this.tarjetaMap.get(f.numero_tarjeta);
      if (m?.placa) f.identificador = m.placa;
    }
  }

  /** BJ2 — el usuario asigna/actualiza el vehículo de una tarjeta; se aprende y se
   *  re-resuelven las filas del preview al vuelo. */
  async asignarVehiculoTarjeta(codigo: string, vehiculoId: string) {
    const entry = this.cardsDetectadas().find((c) => c.card.codigo === codigo);
    if (!entry) return;
    const vid = vehiculoId || null;
    this.cardsDetectadas.set(
      this.cardsDetectadas().map((c) => (c.card.codigo === codigo ? { ...c, guardando: true } : c)),
    );
    try {
      await this.service.setTarjetaMap({
        codigo,
        vehiculo_id: vid,
        titular: entry.card.titular || null,
        es_persona: entry.card.es_persona,
      });
      // Refresca el mapa y re-resuelve el preview.
      const placa = this.vehiculos().find((v) => v.id === vid)?.placa ?? null;
      this.tarjetaMap.set(codigo, {
        codigo_tarjeta: codigo,
        vehiculo_id: vid,
        placa,
        titular_nombre: entry.card.titular || null,
        es_persona: entry.card.es_persona,
        usuario_id: null,
        notas: null,
      });
      const filas = this.preview();
      if (filas) {
        this.aplicarMapeoAFilas(filas);
        this.preview.set([...filas]);
      }
      this.cardsDetectadas.set(
        this.cardsDetectadas().map((c) => (c.card.codigo === codigo ? { ...c, vehiculo_id: vid, guardando: false } : c)),
      );
      this.toast.success('Tarjeta mapeada', placa ? `Ahora cruza con ${placa}.` : 'Sin vehículo (queda como consumo suelto).');
    } catch (e: unknown) {
      this.cardsDetectadas.set(
        this.cardsDetectadas().map((c) => (c.card.codigo === codigo ? { ...c, guardando: false } : c)),
      );
      this.toast.error('No se pudo mapear la tarjeta', e instanceof Error ? e.message : undefined);
    }
  }

  /** Z23 — Confirma: inserta transacciones (dedupe) y concilia contra la plataforma. */
  async confirmarImport() {
    const filas = (this.preview() ?? []).filter((f) => !f.invalida && !f.duplicada && !f.excluida);
    if (filas.length === 0) {
      this.toast.error('No hay transacciones nuevas que importar.');
      return;
    }
    this.importando.set(true);
    try {
      const payload = filas.map((f) => ({
        transaccion_num: f.transaccion_num,
        numero_factura: f.numero_factura || null,
        fecha_factura: f.fecha_factura,
        total_factura: f.total_factura,
        fecha: f.fecha,
        hora: f.hora || null,
        numero_tarjeta: f.numero_tarjeta || null,
        numero_registro: f.numero_registro || null,
        titular: f.titular || null,
        titular_es_persona: f.titular_es_persona,
        kilometraje: f.kilometraje,
        estacion_codigo: f.estacion_codigo || null,
        estacion_ubicacion: f.estacion_ubicacion || null,
        producto: f.producto || null,
        galones: f.galones,
        precio_unitario: null,
        importe: f.monto,
        ncf: f.ncf || null,
        trans_status: f.trans_status || null,
        // BJ2 — vehículo resuelto por el mapeo de tarjeta + alerta de la factura.
        vehiculo_id: this.tarjetaMap.get(f.numero_tarjeta)?.vehiculo_id ?? null,
        alerta: f.alerta ?? null,
      }));
      const nuevas = await this.service.importarTransacciones(payload);
      await this.conciliar(filas, this.nombreArchivo() ?? 'informe');
      this.preview.set(null);
      this.toast.success('Transacciones importadas', `${nuevas} nueva(s). Revisa la conciliación abajo.`);
    } catch (e: unknown) {
      this.toast.error('No se pudo importar', e instanceof Error ? e.message : undefined);
    } finally {
      this.importando.set(false);
    }
  }

  /** Lee el Excel/CSV. Prioriza los encabezados EXACTOS del reporte Total Energies
   *  (con guiones bajos) y cae a detección difusa para otros formatos. */
  private async parseInforme(file: File): Promise<InformeRow[]> {
    const XLSX = await import('xlsx');
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { cellDates: true });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null });
    if (rows.length === 0) return [];

    const keys = Object.keys(rows[0]);
    const norm = (k: string) => k.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    // Coincidencia exacta (por nombre normalizado) o, si no, difusa que EXCLUYE términos.
    const col = (exact: string[], incluye: string[] = [], excluye: string[] = []): string | undefined => {
      for (const e of exact) { const k = keys.find((x) => norm(x) === norm(e)); if (k) return k; }
      if (incluye.length === 0) return undefined;
      return keys.find((x) => {
        const n = norm(x);
        return incluye.some((w) => n.includes(w)) && !excluye.some((w) => n.includes(w));
      });
    };

    const kTrans = col(['Transacción_num']);
    const kFecha = col(['Fecha_de_Transacción'], ['fecha'], ['documento', 'vencimiento', 'caducidad']);
    const kHora = col(['hora_de_transacción'], ['hora']);
    const kGal = col(['Cantidad'], ['galon', 'litro'], ['factura', 'impuesto']); // 'Cantidad' exacto, NO Cantidad_de_...
    const kMonto = col(['Importe_IVA_incluido', 'Importe_sin_impuestos'], ['importe', 'monto'], ['factura', 'impuesto', 'iva']);
    const kRegistro = col(['Número_de_registro']);
    const kTitular = col(['Titular_de_la_tarjeta']);
    const kTarjeta = col(['Número_de_tarjeta']);
    const kProducto = col(['Producto_o_artículo'], ['producto', 'articulo']);
    const kKm = col(['Kilometraje'], ['kilometraje', 'odometro']);
    const kEstCod = col(['Código_de_estación']);
    const kEstUbi = col(['Ubicación'], ['ubicacion']);
    const kNcf = col(['Número_NCF']);
    const kStatus = col(['Trans_Status']);
    const kFactNum = col(['Número_del_Documento']);
    const kFactTot = col(['Importe_de_la_factura_incl']);
    const kFactFecha = col(['Fecha_del_documento']);
    const kId = kRegistro ?? col([], ['placa', 'tarjeta', 'vehiculo', 'unidad', 'ficha']);

    const out: InformeRow[] = [];
    for (const r of rows) {
      const registro = String(r[kRegistro ?? ''] ?? '').trim();
      const titular = String(r[kTitular ?? ''] ?? '').trim();
      const registroValido = registro !== '' && !/^x+$/i.test(registro);
      const identificador = registroValido ? registro : (kId ? String(r[kId ?? ''] ?? '').trim() : titular);
      const galones = this.toNum(kGal ? r[kGal] : null);
      const monto = this.toNum(kMonto ? r[kMonto] : null);
      const fecha = this.toIso(kFecha ? r[kFecha] : null);
      const transaccion_num = String(r[kTrans ?? ''] ?? '').trim();
      const producto = String(r[kProducto ?? ''] ?? '').trim();
      const invalida = !transaccion_num || (galones == null && monto == null);
      if (invalida && !identificador && !fecha) continue;
      // BB7 — motivo(s) legibles del rechazo/duda (el parser sabe por qué).
      const motivos: string[] = [];
      if (!transaccion_num) motivos.push('sin número de transacción');
      if (galones == null && monto == null) motivos.push('sin galones ni monto');
      else if (galones == null) motivos.push('sin galones');
      else if (monto == null) motivos.push('sin monto');
      if (!producto) motivos.push('producto vacío');
      if (!identificador) motivos.push('sin identificador de vehículo/tarjeta');
      out.push({
        identificador,
        fecha,
        galones,
        monto,
        transaccion_num,
        titular,
        // Tarjeta a persona: sin placa válida en Número_de_registro.
        titular_es_persona: !registroValido && titular !== '',
        numero_tarjeta: String(r[kTarjeta ?? ''] ?? '').trim(),
        numero_registro: registro,
        producto,
        motivos,
        kilometraje: this.toNum(kKm ? r[kKm] : null),
        hora: String(r[kHora ?? ''] ?? '').trim(),
        estacion_codigo: String(r[kEstCod ?? ''] ?? '').trim(),
        estacion_ubicacion: String(r[kEstUbi ?? ''] ?? '').trim(),
        ncf: String(r[kNcf ?? ''] ?? '').trim(),
        trans_status: String(r[kStatus ?? ''] ?? '').trim(),
        numero_factura: String(r[kFactNum ?? ''] ?? '').trim(),
        total_factura: this.toNum(kFactTot ? r[kFactTot] : null),
        fecha_factura: this.toIso(kFactFecha ? r[kFactFecha] : null),
        invalida,
      });
    }
    return out;
  }

  /** Convierte a número tolerando formato dominicano (coma decimal "28,57"). */
  private toNum(v: unknown): number | null {
    if (v == null || v === '') return null;
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    let s = String(v).trim().replace(/rd\$?/i, '').replace(/[$\s]/g, '');
    if (s.includes(',') && s.includes('.')) s = s.replace(/,/g, ''); // coma = miles
    else if (s.includes(',')) s = s.replace(',', '.'); // coma = decimal
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }

  private toIso(v: unknown): string | null {
    if (v == null || v === '') return null;
    if (v instanceof Date && !isNaN(v.getTime())) {
      return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
    }
    const s = String(v).trim();
    // dd/mm/yyyy o dd-mm-yyyy
    const m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
    if (m) {
      const [, d, mo, y] = m;
      const yy = y.length === 2 ? `20${y}` : y;
      return `${yy}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
    }
    const iso = s.match(/^\d{4}-\d{2}-\d{2}/);
    return iso ? iso[0] : null;
  }

  private norm(placa: string): string {
    return placa.toUpperCase().replace(/[\s-]/g, '');
  }

  private diasEntre(a: string, b: string): number {
    return Math.abs((Date.parse(a + 'T00:00:00') - Date.parse(b + 'T00:00:00')) / 86400000);
  }

  /** Cruza el informe contra los registros de la plataforma en el rango. */
  private async conciliar(informe: InformeRow[], nombre: string) {
    const fechas = informe.map((r) => r.fecha).filter((f): f is string => !!f).sort();
    const desde = fechas[0] ?? null;
    const hasta = fechas[fechas.length - 1] ?? null;

    const registros = await this.service.getRegistrosEnRango(desde, hasta);
    const usados = new Set<string>();
    const detalles: ConciliacionDetalle[] = [];

    let matches = 0, diferencias = 0, soloInforme = 0;
    let montoInforme = 0, galonesInforme = 0;

    for (const inf of informe) {
      montoInforme += inf.monto ?? 0;
      galonesInforme += inf.galones ?? 0;
      const idn = this.norm(inf.identificador);
      // Busca un registro no usado con misma placa y fecha dentro de la tolerancia.
      const cand = registros.find(
        (reg) =>
          !usados.has(reg.id) &&
          this.norm(reg.vehiculo?.placa ?? '') === idn &&
          idn !== '' &&
          (!inf.fecha || !reg.fecha || this.diasEntre(inf.fecha, reg.fecha) <= DIAS_TOLERANCIA),
      );
      if (cand) {
        usados.add(cand.id);
        const gp = Number(cand.galones) || 0;
        const mp = Number(cand.monto) || 0;
        const dg = (inf.galones ?? 0) - gp;
        const dm = (inf.monto ?? 0) - mp;
        const hayDif = Math.abs(dg) > GAL_TOLERANCIA || Math.abs(dm) > MONTO_TOLERANCIA;
        if (hayDif) diferencias++; else matches++;
        detalles.push({
          tipo: hayDif ? 'diferencia' : 'match',
          registro_id: cand.id,
          vehiculo_id: cand.vehiculo_id,
          identificador: inf.identificador || cand.vehiculo?.placa || null,
          fecha: inf.fecha ?? cand.fecha,
          galones_plataforma: gp,
          galones_informe: inf.galones,
          monto_plataforma: mp,
          monto_informe: inf.monto,
          diferencia_galones: dg,
          diferencia_monto: dm,
        });
      } else {
        soloInforme++;
        detalles.push({
          tipo: 'solo_informe',
          registro_id: null,
          vehiculo_id: null,
          identificador: inf.identificador || null,
          fecha: inf.fecha,
          galones_plataforma: null,
          galones_informe: inf.galones,
          monto_plataforma: null,
          monto_informe: inf.monto,
          diferencia_galones: null,
          diferencia_monto: null,
        });
      }
    }

    // Registros de la plataforma sin contraparte en el informe.
    let soloPlataforma = 0, montoPlataforma = 0, galonesPlataforma = 0;
    for (const reg of registros) {
      montoPlataforma += Number(reg.monto) || 0;
      galonesPlataforma += Number(reg.galones) || 0;
      if (usados.has(reg.id)) continue;
      soloPlataforma++;
      detalles.push({
        tipo: 'solo_plataforma',
        registro_id: reg.id,
        vehiculo_id: reg.vehiculo_id,
        identificador: reg.vehiculo?.placa ?? null,
        fecha: reg.fecha,
        galones_plataforma: Number(reg.galones) || 0,
        galones_informe: null,
        monto_plataforma: Number(reg.monto) || 0,
        monto_informe: null,
        diferencia_galones: null,
        diferencia_monto: null,
      });
    }

    this.detalles.set(detalles);
    this.meta.set({
      estacion: this.estacionSel(),
      fecha_desde: desde,
      fecha_hasta: hasta,
      nombre_archivo: nombre,
      total_informe_filas: informe.length,
      total_matches: matches,
      total_solo_plataforma: soloPlataforma,
      total_solo_informe: soloInforme,
      total_diferencias: diferencias,
      monto_plataforma: montoPlataforma,
      monto_informe: montoInforme,
      galones_plataforma: galonesPlataforma,
      galones_informe: galonesInforme,
      notas: null,
    });
    this.tab.set(diferencias > 0 ? 'diferencia' : soloInforme > 0 ? 'solo_informe' : 'match');
  }

  /** Z23.3 — Exporta a Excel las filas visibles (pestaña activa + filtros). */
  async exportar() {
    const etiquetaTipo: Record<ConciliacionDetalle['tipo'], string> = {
      match: 'Coincide',
      diferencia: 'Diferencia',
      solo_plataforma: 'Solo plataforma',
      solo_informe: 'Solo informe',
    };
    const filas = this.detallesFiltrados().map((d) => ({
      Tipo: etiquetaTipo[d.tipo],
      'Placa / tarjeta': d.identificador ?? '',
      Fecha: d.fecha ? this.formatFecha(d.fecha) : '',
      'Galones informe': d.galones_informe ?? '',
      'Galones plataforma': d.galones_plataforma ?? '',
      'Monto informe': d.monto_informe ?? '',
      'Monto plataforma': d.monto_plataforma ?? '',
      'Δ galones': d.diferencia_galones ?? '',
      'Δ monto': d.diferencia_monto ?? '',
    }));
    await exportarExcel(`conciliacion-combustible-${this.tab()}`, filas);
  }

  async guardar() {
    const meta = this.meta();
    if (!meta || this.saving()) return;
    this.saving.set(true);
    try {
      // BJ2 — guarda la factura PDF original ligada a la conciliación (traza fiscal).
      if (this.archivoPdf) {
        try {
          meta.pdf_path = await this.service.subirPdf(this.archivoPdf);
        } catch {
          this.toast.warning('Conciliación guardada sin el PDF', 'No se pudo subir la factura; el cuadre sí se guarda.');
        }
      }
      await this.service.guardar(meta, this.detalles());
      this.toast.success(
        'Conciliación guardada',
        this.discrepancias() > 0
          ? `Se notificó a Flota ${this.discrepancias()} discrepancia(s).`
          : 'Sin discrepancias.',
      );
      this.detalles.set([]);
      this.meta.set(null);
      this.nombreArchivo.set(null);
      await this.cargarHistorial();
    } catch (e: unknown) {
      this.toast.error('No se pudo guardar', e instanceof Error ? e.message : undefined);
    } finally {
      this.saving.set(false);
    }
  }
}
