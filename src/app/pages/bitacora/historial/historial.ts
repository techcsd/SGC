import { Component, ChangeDetectionStrategy, inject, signal, computed, OnInit } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { BitacoraService } from '../../../../shared/services/bitacora.service';
import { ProyectosService } from '../../../../shared/services/proyectos.service';
import { Bitacora, BitacoraArchivo, BITACORA_TIPOS, VISITANTE_TIPOS, INCIDENTE_TIPOS, INCIDENTE_GRAVEDADES } from '../../../../shared/models/bitacora.model';
import { Proyecto } from '../../../../shared/models/proyecto.model';
import { formatFechaDisplay, formatHora12, formatFechaHumana } from '../../../../shared/utils/fecha.util';
import { FormDrawer } from '../../../../shared/components/form-drawer/form-drawer';
import { Skeleton } from '../../../../shared/components/skeleton/skeleton';
import { interpretarCodigoTiempo } from '../../../../shared/context/weather.model';

@Component({
  selector: 'app-bitacora-historial',
  imports: [Skeleton, RouterLink, FormDrawer, DecimalPipe],
  templateUrl: './historial.html',
  styleUrl: './historial.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Historial implements OnInit {
  private bitacoraService = inject(BitacoraService);
  private proyectosService = inject(ProyectosService);

  formatFecha = formatFechaDisplay;
  formatFechaHora = formatFechaHumana; // U13 — "registrada el…"
  formatHora = formatHora12;

  bitacoras = signal<Bitacora[]>([]);
  proyectos = signal<Proyecto[]>([]);
  loading = signal(true);
  error = signal('');

  // ── Filters ──────────────────────────────────────────────
  searchQuery = signal('');
  selectedProyecto = signal('');
  dateFrom = signal('');
  dateTo = signal('');

  // ── Pagination ───────────────────────────────────────────
  currentPage = signal(1);
  readonly PAGE_SIZE = 20;

  // ── Detail drawer ────────────────────────────────────────
  detailOpen = signal(false);
  detail = signal<Bitacora | null>(null);
  archivoUrls = signal<Map<string, string>>(new Map());

  /** Icon + label for the captured weather of the entry being viewed. */
  detailTiempo = computed(() => interpretarCodigoTiempo(this.detail()?.weather_snapshot?.codigo_tiempo ?? null));

  filtered = computed(() => {
    const q = this.searchQuery().toLowerCase().trim();
    const proyectoId = this.selectedProyecto();
    const from = this.dateFrom();
    const to = this.dateTo();

    return this.bitacoras().filter((b) => {
      if (
        q &&
        !(b.bloque_entrepiso ?? '').toLowerCase().includes(q) &&
        !(b.ingeniero_responsable ?? '').toLowerCase().includes(q) &&
        !(b.visita_nombre ?? '').toLowerCase().includes(q) &&
        !(b.incidente_subcontratista ?? '').toLowerCase().includes(q)
      ) {
        return false;
      }
      if (proyectoId && b.proyecto_id !== proyectoId) return false;
      if (from && b.fecha < from) return false;
      if (to && b.fecha > to) return false;
      return true;
    });
  });

  paginated = computed(() => {
    const start = (this.currentPage() - 1) * this.PAGE_SIZE;
    return this.filtered().slice(start, start + this.PAGE_SIZE);
  });

  totalPages = computed(() => Math.ceil(this.filtered().length / this.PAGE_SIZE));

  hasActiveFilters = computed(
    () => !!(this.searchQuery() || this.selectedProyecto() || this.dateFrom() || this.dateTo()),
  );

  drawerTitle = computed(() => {
    const b = this.detail();
    return b ? `Bitácora — ${this.formatFecha(b.fecha)}` : 'Bitácora';
  });

  async ngOnInit() {
    await this.loadAll();
  }

  private async loadAll() {
    this.loading.set(true);
    this.error.set('');
    try {
      const [bitacoras, proyectos] = await Promise.all([
        this.bitacoraService.getAll(),
        this.proyectosService.getAll(),
      ]);
      this.bitacoras.set(bitacoras);
      this.proyectos.set(proyectos);
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'Error al cargar las bitácoras.');
    } finally {
      this.loading.set(false);
    }
  }

  // ── Filters ──────────────────────────────────────────────
  onSearch(value: string) {
    this.searchQuery.set(value);
    this.currentPage.set(1);
  }

  onProyectoChange(value: string) {
    this.selectedProyecto.set(value);
    this.currentPage.set(1);
  }

  onDateFromChange(value: string) {
    this.dateFrom.set(value);
    this.currentPage.set(1);
  }

  onDateToChange(value: string) {
    this.dateTo.set(value);
    this.currentPage.set(1);
  }

  clearFilters() {
    this.searchQuery.set('');
    this.selectedProyecto.set('');
    this.dateFrom.set('');
    this.dateTo.set('');
    this.currentPage.set(1);
  }

  // ── Pagination ───────────────────────────────────────────
  goToPage(page: number) {
    if (page >= 1 && page <= this.totalPages()) {
      this.currentPage.set(page);
    }
  }

  get pages(): number[] {
    const total = this.totalPages();
    const current = this.currentPage();
    const delta = 2;
    const range: number[] = [];
    for (let i = Math.max(1, current - delta); i <= Math.min(total, current + delta); i++) {
      range.push(i);
    }
    return range;
  }

  // ── Detail ───────────────────────────────────────────────
  async openDetail(b: Bitacora) {
    this.detailOpen.set(true);
    this.detail.set(b);
    this.archivoUrls.set(new Map());
    try {
      const full = await this.bitacoraService.getById(b.id);
      this.detail.set(full);
      await this.resolveArchivoUrls(full.archivos ?? []);
    } catch {
      // keep basic data
    }
  }

  closeDetail() {
    this.detailOpen.set(false);
    this.detail.set(null);
  }

  private async resolveArchivoUrls(archivos: BitacoraArchivo[]) {
    const entries = await Promise.all(
      archivos.map(async (a) => {
        try {
          return [a.id, await this.bitacoraService.getSignedUrl(a.url)] as const;
        } catch {
          return [a.id, ''] as const;
        }
      }),
    );
    this.archivoUrls.set(new Map(entries));
  }

  getArchivoUrl(archivo: BitacoraArchivo): string {
    return this.archivoUrls().get(archivo.id) ?? '';
  }

  /** Photos captured in the field render inline; voice notes get an audio
   *  player. Anything else stays a download link. */
  isImagen(a: BitacoraArchivo): boolean {
    return (a.tipo_mime ?? '').startsWith('image/') || /\.(jpe?g|png|webp|gif)$/i.test(a.nombre);
  }
  isAudio(a: BitacoraArchivo): boolean {
    return (a.tipo_mime ?? '').startsWith('audio/') || /\.(webm|m4a|mp3|ogg|wav)$/i.test(a.nombre);
  }

  actividadesResumen(b: Bitacora): string {
    const count = b.actividades?.length ?? 0;
    return count === 0 ? 'Sin actividades' : `${count} actividad${count !== 1 ? 'es' : ''}`;
  }

  /** R22 — normaliza el jsonb `migracion_obreros` (unknown) a lista de textos. */
  migracionObreros(b: Bitacora): string[] {
    const m = b.migracion_obreros;
    if (Array.isArray(m)) return m.map((x) => String(x).trim()).filter(Boolean);
    return [];
  }

  restriccionesResumen(b: Bitacora): string {
    const restricciones = b.restricciones ?? [];
    if (restricciones.length === 0) return '—';
    return restricciones.map((r) => r.tipo_restriccion).join(', ');
  }

  tipoLabel(tipo: string): string {
    return BITACORA_TIPOS.find((t) => t.value === tipo)?.label ?? tipo;
  }

  tipoBadgeClass(tipo: string): string {
    switch (tipo) {
      case 'visita': return 'sgc-badge sgc-badge--info';
      case 'incidente': return 'sgc-badge sgc-badge--danger';
      default: return 'sgc-badge sgc-badge--neutral';
    }
  }

  visitanteLabel(v: string | null): string {
    return VISITANTE_TIPOS.find((x) => x.value === v)?.label ?? (v ?? '—');
  }

  incidenteTipoLabel(v: string | null): string {
    return INCIDENTE_TIPOS.find((x) => x.value === v)?.label ?? (v ?? '—');
  }

  gravedadLabel(v: string | null): string {
    return INCIDENTE_GRAVEDADES.find((x) => x.value === v)?.label ?? (v ?? '—');
  }

  /** Short subject line for a row/title, adapting to entry type. */
  resumenEntrada(b: Bitacora): string {
    if (b.tipo === 'visita') return b.visita_nombre ?? 'Visita';
    if (b.tipo === 'incidente') return b.incidente_subcontratista ?? this.incidenteTipoLabel(b.incidente_tipo);
    return b.bloque_entrepiso ?? '—';
  }

  proyectoNombre(b: Bitacora): string {
    return b.proyecto?.nombre ?? this.proyectos().find((p) => p.id === b.proyecto_id)?.nombre ?? '—';
  }

  private personalTotal(b: Bitacora): number {
    return (b.personal_carpinteria ?? 0) + (b.personal_acero ?? 0) + (b.trabajadores_casa ?? 0);
  }

  // ── U15 — Export PDF (impresión) + Excel (xlsx) ───────────
  /** PDF vía impresión del navegador (reutiliza el print CSS global -report-print). */
  imprimir() {
    window.print();
  }

  /** Aplana una bitácora a una fila de resumen para Excel. */
  private filaExcel(b: Bitacora): Record<string, string | number> {
    return {
      Fecha: this.formatFecha(b.fecha),
      Obra: this.proyectoNombre(b),
      Tipo: this.tipoLabel(b.tipo),
      Ingeniero: b.ingeniero_responsable ?? '',
      Personal: this.personalTotal(b),
      Llovió: b.llovio == null ? '' : b.llovio ? 'Sí' : 'No',
      Migración: b.hubo_migracion == null ? '' : b.hubo_migracion ? 'Sí' : 'No',
      'Obreros afectados': this.migracionObreros(b).length,
      Actividades: b.actividades?.length ?? 0,
      'Equipos alquilados': b.equipos?.length ?? 0,
      Restricciones: this.restriccionesResumen(b),
      Incidente: b.tipo === 'incidente' ? `${this.incidenteTipoLabel(b.incidente_tipo)} (${this.gravedadLabel(b.incidente_gravedad)})` : '',
      Comentarios: b.comentarios ?? '',
    };
  }

  /** Exporta el listado filtrado a Excel (lote). */
  async exportarListaExcel() {
    const XLSX = await import('xlsx');
    const rows = this.filtered().map((b) => this.filaExcel(b));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Bitácoras');
    XLSX.writeFile(wb, `bitacoras-${this.dateFrom() || 'inicio'}_${this.dateTo() || 'hoy'}.xlsx`);
  }

  /** Exporta la bitácora abierta a Excel (individual): resumen + actividades + restricciones. */
  async exportarDetalleExcel() {
    const b = this.detail();
    if (!b) return;
    const XLSX = await import('xlsx');
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([this.filaExcel(b)]), 'Resumen');
    if (b.actividades?.length) {
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.json_to_sheet(
          b.actividades.map((a) => ({ Estructura: a.estructura, Actividad: a.actividad, Cantidad: a.cantidad ?? '' })),
        ),
        'Actividades',
      );
    }
    if (b.restricciones?.length) {
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.json_to_sheet(
          b.restricciones.map((r) => ({ Restricción: r.tipo_restriccion, Descripción: r.descripcion_otro ?? '' })),
        ),
        'Restricciones',
      );
    }
    if (b.equipos?.length) {
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.json_to_sheet(
          b.equipos.map((e) => ({ Equipo: e.equipo, Uso: e.uso ?? '', Proveedor: e.proveedor ?? '' })),
        ),
        'Equipos alquilados',
      );
    }
    XLSX.writeFile(wb, `bitacora-${b.fecha}.xlsx`);
  }
}
