import { Component, ChangeDetectionStrategy, inject, signal, computed, OnInit } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { BitacoraService } from '../../../../shared/services/bitacora.service';
import { UserService } from '../../../core/services/user.service';
import { DatosPruebaViewService } from '../../../../shared/services/datos-prueba-view.service';
import { BitacoraMoldeOffice, MoldeTramoData } from '../../../../shared/models/bitacora.model';
import { formatFechaDisplay } from '../../../../shared/utils/fecha.util';
import { exportarExcel } from '../../../../shared/utils/exportar-excel.util';
import { Skeleton } from '../../../../shared/components/skeleton/skeleton';
import { Icon } from '../../../../shared/ui/icon/icon';
import { DateRangeFilter, RangoFecha } from '../../../../shared/ui/date-range-filter/date-range-filter';
import { MoldeEsquema, MoldeTramo } from '../../../../shared/ui/molde-esquema/molde-esquema';

/**
 * BO9 — Vista de oficina: revisión de medidas de moldes por obra. Lista las filas
 * de `bitacora_molde_medidas` (join a su bitácora) con la desviación real↔plano y
 * una miniatura del esquema por fila. Filtra por estructura y por rango de fechas;
 * exporta el listado filtrado a Excel.
 */
@Component({
  selector: 'app-bitacora-moldes',
  imports: [DecimalPipe, RouterLink, Skeleton, Icon, DateRangeFilter, MoldeEsquema],
  templateUrl: './moldes.html',
  styleUrl: './moldes.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BitacoraMoldes implements OnInit {
  private bitacoraService = inject(BitacoraService);
  private userService = inject(UserService);
  private datosPruebaViewSvc = inject(DatosPruebaViewService);

  formatFecha = formatFechaDisplay;

  moldes = signal<BitacoraMoldeOffice[]>([]);
  loading = signal(true);
  error = signal('');

  toleranciaCm = signal(2); // espejo de sgc.parametros.molde_tolerancia_cm

  esAdmin = computed(() => this.userService.hasRole('admin'));
  mostrarPrueba = this.datosPruebaViewSvc.ver;

  // ── Filtros ──────────────────────────────────────────────
  selectedEstructura = signal('');
  dateFrom = signal('');
  dateTo = signal('');

  /** Estructuras presentes (para el select), ordenadas. */
  estructuras = computed(() => {
    const set = new Set<string>();
    for (const m of this.moldes()) {
      const e = (m.estructura ?? '').trim();
      if (e) set.add(e);
    }
    return [...set].sort((a, b) => a.localeCompare(b, 'es'));
  });

  filtered = computed(() => {
    const estr = this.selectedEstructura();
    const from = this.dateFrom();
    const to = this.dateTo();
    const verPrueba = this.esAdmin() && this.mostrarPrueba();
    return this.moldes().filter((m) => {
      if (m.es_prueba && !verPrueba) return false;
      if (estr && (m.estructura ?? '').trim() !== estr) return false;
      const fecha = m.bitacora?.fecha ?? '';
      if (from && fecha < from) return false;
      if (to && fecha > to) return false;
      return true;
    });
  });

  hasActiveFilters = computed(() => !!(this.selectedEstructura() || this.dateFrom() || this.dateTo()));

  async ngOnInit() {
    await this.load();
  }

  private async load() {
    this.loading.set(true);
    this.error.set('');
    try {
      this.moldes.set(await this.bitacoraService.getMoldes());
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'Error al cargar las medidas de moldes.');
    } finally {
      this.loading.set(false);
    }
  }

  // ── Filtros ──────────────────────────────────────────────
  onEstructuraChange(value: string) {
    this.selectedEstructura.set(value);
  }

  onRango(r: RangoFecha) {
    this.dateFrom.set(r.desde ?? '');
    this.dateTo.set(r.hasta ?? '');
  }

  clearFilters() {
    this.selectedEstructura.set('');
    this.dateFrom.set('');
    this.dateTo.set('');
  }

  // ── Helpers de presentación ──────────────────────────────
  obraNombre(m: BitacoraMoldeOffice): string {
    return m.bitacora?.proyecto?.nombre ?? '—';
  }

  ingeniero(m: BitacoraMoldeOffice): string {
    return m.bitacora?.ingeniero_responsable?.trim() || '—';
  }

  moldeTitulo(m: BitacoraMoldeOffice): string {
    const partes = [m.estructura, m.identificador].map((x) => (x ?? '').trim()).filter(Boolean);
    return partes.join(' · ') || 'Molde';
  }

  /** Tramos tipados para el esquema (medida real). */
  tramosReal(m: BitacoraMoldeOffice): MoldeTramo[] {
    return (m.tramos ?? []) as MoldeTramo[];
  }

  /** Medida de plano para el esquema, o null si no se capturó. */
  tramosPlano(m: BitacoraMoldeOffice): MoldeTramo[] | null {
    const p = m.medida_plano;
    return Array.isArray(p) && p.length ? (p as MoldeTramo[]) : null;
  }

  /** ¿La desviación supera la tolerancia? (fila a resaltar). */
  fueraTolerancia(m: BitacoraMoldeOffice): boolean {
    return m.desviacion_max_cm != null && m.desviacion_max_cm > this.toleranciaCm();
  }

  /** Resumen textual de un tramo: "A: 120×80 e5". */
  private tramoTexto(t: MoldeTramoData): string {
    const dims: string[] = [];
    if (t.largo_cm != null) dims.push(String(t.largo_cm));
    if (t.alto_cm != null) dims.push(String(t.alto_cm));
    const base = dims.join('×');
    const esp = t.espesor_cm != null ? ` e${t.espesor_cm}` : '';
    const lado = t.lado ? `${t.lado}: ` : '';
    return `${lado}${base}${esp}`.trim();
  }

  medidasReal(m: BitacoraMoldeOffice): string {
    return (m.tramos ?? []).map((t) => this.tramoTexto(t)).join('  |  ') || '—';
  }

  medidasPlano(m: BitacoraMoldeOffice): string {
    const p = m.medida_plano;
    if (!Array.isArray(p) || !p.length) return '—';
    return p.map((t) => this.tramoTexto(t)).join('  |  ') || '—';
  }

  // ── Export ───────────────────────────────────────────────
  async exportarExcelLista() {
    const rows = this.filtered().map((m) => ({
      Obra: this.obraNombre(m),
      Fecha: m.bitacora?.fecha ? this.formatFecha(m.bitacora.fecha) : '',
      Ingeniero: this.ingeniero(m),
      Estructura: m.estructura ?? '',
      Identificador: m.identificador ?? '',
      Forma: m.forma ?? '',
      'Medida real (cm)': this.medidasReal(m),
      'Medida plano (cm)': this.medidasPlano(m),
      'Desviación máx (cm)': m.desviacion_max_cm ?? '',
      'Fuera de tolerancia': this.fueraTolerancia(m) ? 'Sí' : '',
      Notas: m.notas ?? '',
    }));
    await exportarExcel('moldes', rows, 'Moldes');
  }
}
