import { Component, ChangeDetectionStrategy, inject, signal, computed, OnInit } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import {
  CombustibleConciliacionService,
  ConciliacionRegistro,
  ConciliacionDetalle,
  ConciliacionMeta,
} from '../../../../shared/services/combustible-conciliacion.service';
import { EstacionesCombustibleService, EstacionCombustible } from '../../../../shared/services/estaciones-combustible.service';
import { ToastService } from '../../../../shared/services/toast.service';
import { Skeleton } from '../../../../shared/components/skeleton/skeleton';
import { formatFechaDisplay } from '../../../../shared/utils/fecha.util';

/** Fila normalizada del informe importado (Total Energies u otro). */
interface InformeRow {
  identificador: string; // placa/tarjeta
  fecha: string | null; // YYYY-MM-DD
  galones: number | null;
  monto: number | null;
}

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
  imports: [DecimalPipe, Skeleton],
  templateUrl: './conciliacion-combustible.html',
  styleUrl: './conciliacion-combustible.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConciliacionCombustible implements OnInit {
  private service = inject(CombustibleConciliacionService);
  private estacionesService = inject(EstacionesCombustibleService);
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

  /** Detalles resultantes del último cruce (en memoria, aún sin guardar). */
  detalles = signal<ConciliacionDetalle[]>([]);
  meta = signal<ConciliacionMeta | null>(null);
  /** Pestaña activa del resultado. */
  tab = signal<'diferencia' | 'solo_plataforma' | 'solo_informe' | 'match'>('diferencia');

  detallesPorTab = computed(() => this.detalles().filter((d) => d.tipo === this.tab()));

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

  /** Importa y cruza el archivo del informe. */
  async onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.parseError.set('');
    this.parsing.set(true);
    this.nombreArchivo.set(file.name);
    try {
      const filas = await this.parseInforme(file);
      if (filas.length === 0) {
        this.parseError.set('No se detectaron filas válidas (fecha/placa/galones/monto) en el archivo.');
        this.detalles.set([]);
        this.meta.set(null);
        return;
      }
      await this.conciliar(filas, file.name);
    } catch (e: unknown) {
      this.parseError.set(e instanceof Error ? e.message : 'No se pudo leer el archivo.');
    } finally {
      this.parsing.set(false);
    }
  }

  /** Lee el Excel/CSV y detecta columnas por palabras clave del encabezado. */
  private async parseInforme(file: File): Promise<InformeRow[]> {
    const XLSX = await import('xlsx');
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { cellDates: true });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null });
    if (rows.length === 0) return [];

    const keys = Object.keys(rows[0]);
    const find = (...kw: string[]) =>
      keys.find((k) =>
        kw.some((w) => k.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').includes(w)),
      );
    const kFecha = find('fecha', 'date', 'dia');
    const kId = find('placa', 'tarjeta', 'vehiculo', 'vehículo', 'unidad', 'ficha');
    const kGal = find('galon', 'galón', 'gallon', 'cantidad', 'litro');
    const kMonto = find('monto', 'importe', 'total', 'valor', 'amount');

    const out: InformeRow[] = [];
    for (const r of rows) {
      const fecha = this.toIso(kFecha ? r[kFecha] : null);
      const identificador = kId ? String(r[kId] ?? '').trim() : '';
      const galones = this.toNum(kGal ? r[kGal] : null);
      const monto = this.toNum(kMonto ? r[kMonto] : null);
      if (!identificador && !fecha && galones == null && monto == null) continue;
      out.push({ identificador, fecha, galones, monto });
    }
    return out;
  }

  private toNum(v: unknown): number | null {
    if (v == null || v === '') return null;
    const n = Number(String(v).replace(/[$,\s]/g, ''));
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

  async guardar() {
    const meta = this.meta();
    if (!meta || this.saving()) return;
    this.saving.set(true);
    try {
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
