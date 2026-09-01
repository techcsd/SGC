import { Component, ChangeDetectionStrategy, inject, signal, computed, OnInit } from '@angular/core';
import { RouterLink } from '@angular/router';
import { SalidasService } from '../../../../shared/services/salidas.service';
import {
  ConduceListadoRow,
  ConduceBucket,
  SALIDA_ESTADO_LABELS,
  conduceNumero,
} from '../../../../shared/models/salida.model';
import { formatFechaDisplay } from '../../../../shared/utils/fecha.util';
import { exportarExcel } from '../../../../shared/utils/exportar-excel.util';
import { Skeleton } from '../../../../shared/components/skeleton/skeleton';
import { Icon } from '../../../../shared/ui/icon/icon';

type Tab = 'activos' | 'pendientes_entrega' | 'por_confirmar' | 'historico';

const FASE_LABELS: Record<string, string> = {
  emitido: 'Emitido',
  en_transito: 'En tránsito',
  entregando: 'Entregando',
  entregado: 'Entregado',
  pendiente_firma: 'Pendiente de firma',
  confirmado: 'Confirmado',
};

// AO5 — Submódulo Conduces (web): TODOS los conduces con pestañas
// Activos | Pendientes de entrega | Por confirmar | Histórico, filtros por
// obra/chofer/fecha y badges de conteo. Cada fila abre el detalle + PDF (AL4).
@Component({
  selector: 'app-conduces',
  imports: [RouterLink, Skeleton, Icon],
  templateUrl: './conduces.html',
  styleUrl: './conduces.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Conduces implements OnInit {
  private salidasService = inject(SalidasService);

  formatFecha = formatFechaDisplay;
  readonly ESTADO_LABELS = SALIDA_ESTADO_LABELS;
  readonly FASE_LABELS = FASE_LABELS;
  readonly numero = conduceNumero;

  rows = signal<ConduceListadoRow[]>([]);
  loading = signal(true);
  error = signal('');

  tab = signal<Tab>('activos');
  searchQuery = signal('');
  obraFilter = signal<string>('');        // AP4 — obra DESTINO
  origenFilter = signal<string>('');      // AP4 — obra ORIGEN
  choferFilter = signal<string>('');
  responsableFilter = signal<string>(''); // AP4 — persona (emisor/chofer/receptor)
  desde = signal<string>('');
  hasta = signal<string>('');

  /** AP4 — mapa id→nombre de usuarios para resolver el responsable. */
  private usuariosMap = signal<Record<string, string>>({});

  currentPage = signal(1);
  readonly PAGE_SIZE = 20;

  readonly TABS: { key: Tab; label: string }[] = [
    { key: 'activos', label: 'Activos' },
    { key: 'pendientes_entrega', label: 'Pendientes de entrega' },
    { key: 'por_confirmar', label: 'Por confirmar' },
    { key: 'historico', label: 'Histórico' },
  ];

  /** ¿La fila cae en la pestaña dada? "Activos" = todo lo que no es histórico. */
  private inTab(r: ConduceListadoRow, tab: Tab): boolean {
    if (tab === 'activos') return r.bucket !== 'historico';
    return r.bucket === (tab as ConduceBucket);
  }

  /** Conteos por pestaña (para los badges). */
  counts = computed(() => {
    const c: Record<Tab, number> = { activos: 0, pendientes_entrega: 0, por_confirmar: 0, historico: 0 };
    for (const r of this.rows()) {
      if (r.bucket !== 'historico') c.activos++;
      if (r.bucket === 'pendientes_entrega') c.pendientes_entrega++;
      else if (r.bucket === 'por_confirmar') c.por_confirmar++;
      else c.historico++;
    }
    return c;
  });

  /** Opciones de obra (destino/origen) y chofer para los selects. */
  obras = computed(() => {
    const m = new Map<string, string>();
    for (const r of this.rows()) if (r.proyecto_id && r.proyecto) m.set(r.proyecto_id, r.proyecto);
    return [...m.entries()].map(([id, nombre]) => ({ id, nombre })).sort((a, b) => a.nombre.localeCompare(b.nombre));
  });

  obrasOrigen = computed(() => {
    const m = new Map<string, string>();
    for (const r of this.rows()) if (r.origen_proyecto_id && r.origen_proyecto) m.set(r.origen_proyecto_id, r.origen_proyecto);
    return [...m.entries()].map(([id, nombre]) => ({ id, nombre })).sort((a, b) => a.nombre.localeCompare(b.nombre));
  });

  choferes = computed(() => {
    const s = new Set<string>();
    for (const r of this.rows()) if (r.conductor) s.add(r.conductor);
    return [...s].sort((a, b) => a.localeCompare(b));
  });

  /** AP4 — personas que participan como emisor/chofer/receptor en algún conduce. */
  responsables = computed(() => {
    const names = this.usuariosMap();
    const ids = new Set<string>();
    for (const r of this.rows()) {
      if (r.emisor_id) ids.add(r.emisor_id);
      if (r.chofer_usuario_id) ids.add(r.chofer_usuario_id);
      if (r.receptor_id) ids.add(r.receptor_id);
    }
    return [...ids]
      .map((id) => ({ id, nombre: names[id] ?? '—' }))
      .filter((u) => u.nombre !== '—')
      .sort((a, b) => a.nombre.localeCompare(b.nombre));
  });

  /** AP4 — en qué rol(es) matcheó el responsable seleccionado en una fila. */
  responsableMatch(r: ConduceListadoRow): string[] {
    const uid = this.responsableFilter();
    if (!uid) return [];
    const out: string[] = [];
    if (r.emisor_id === uid) out.push('Emisor');
    if (r.chofer_usuario_id === uid) out.push('Chofer');
    if (r.receptor_id === uid) out.push('Receptor');
    return out;
  }

  filtered = computed(() => {
    const tab = this.tab();
    const q = this.searchQuery().toLowerCase().trim();
    const obra = this.obraFilter();
    const origen = this.origenFilter();
    const chofer = this.choferFilter();
    const responsable = this.responsableFilter();
    const desde = this.desde();
    const hasta = this.hasta();
    return this.rows().filter((r) => {
      if (!this.inTab(r, tab)) return false;
      if (obra && r.proyecto_id !== obra) return false;
      if (origen && r.origen_proyecto_id !== origen) return false;
      if (chofer && r.conductor !== chofer) return false;
      if (
        responsable &&
        r.emisor_id !== responsable &&
        r.chofer_usuario_id !== responsable &&
        r.receptor_id !== responsable
      )
        return false;
      // Comparación de fechas por string YYYY-MM-DD (sin round-trip por Date).
      if (desde && r.fecha < desde) return false;
      if (hasta && r.fecha > hasta) return false;
      if (q) {
        const haystack = [this.numero(r.id), r.proyecto ?? '', r.responsable ?? '', r.bodega ?? '', r.conductor ?? '']
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  });

  paginated = computed(() => {
    const start = (this.currentPage() - 1) * this.PAGE_SIZE;
    return this.filtered().slice(start, start + this.PAGE_SIZE);
  });

  totalPages = computed(() => Math.max(1, Math.ceil(this.filtered().length / this.PAGE_SIZE)));

  hasActiveFilters = computed(
    () =>
      !!this.searchQuery() ||
      !!this.obraFilter() ||
      !!this.origenFilter() ||
      !!this.choferFilter() ||
      !!this.responsableFilter() ||
      !!this.desde() ||
      !!this.hasta(),
  );

  async ngOnInit() {
    this.loading.set(true);
    this.error.set('');
    try {
      const [rows, usuarios] = await Promise.all([
        this.salidasService.getConducesWebListado(),
        this.salidasService.getUsuariosDirectorio().catch(() => []),
      ]);
      this.rows.set(rows);
      this.usuariosMap.set(Object.fromEntries(usuarios.map((u) => [u.id, u.nombre])));
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'Error al cargar los conduces.');
    } finally {
      this.loading.set(false);
    }
  }

  setTab(t: Tab) {
    this.tab.set(t);
    this.currentPage.set(1);
  }

  faseLabel(fase: string): string {
    return this.FASE_LABELS[fase] ?? fase;
  }

  faseModifier(bucket: ConduceBucket): string {
    return bucket === 'historico' ? 'success' : bucket === 'por_confirmar' ? 'warning' : 'info';
  }

  onSearch(value: string) {
    this.searchQuery.set(value);
    this.currentPage.set(1);
  }
  onObra(value: string) {
    this.obraFilter.set(value);
    this.currentPage.set(1);
  }
  onOrigen(value: string) {
    this.origenFilter.set(value);
    this.currentPage.set(1);
  }
  onChofer(value: string) {
    this.choferFilter.set(value);
    this.currentPage.set(1);
  }
  onResponsable(value: string) {
    this.responsableFilter.set(value);
    this.currentPage.set(1);
  }
  onDesde(value: string) {
    this.desde.set(value);
    this.currentPage.set(1);
  }
  onHasta(value: string) {
    this.hasta.set(value);
    this.currentPage.set(1);
  }

  clearFilters() {
    this.searchQuery.set('');
    this.obraFilter.set('');
    this.origenFilter.set('');
    this.choferFilter.set('');
    this.responsableFilter.set('');
    this.desde.set('');
    this.hasta.set('');
    this.currentPage.set(1);
  }

  goToPage(page: number) {
    if (page >= 1 && page <= this.totalPages()) this.currentPage.set(page);
  }

  get pages(): number[] {
    return Array.from({ length: this.totalPages() }, (_, i) => i + 1);
  }

  /** Exporta los conduces filtrados (pestaña actual) a Excel. */
  async exportar() {
    const rows = this.filtered().map((r) => ({
      'No. Conduce': this.numero(r.id),
      Fecha: this.formatFecha(r.fecha),
      Almacén: r.bodega ?? '',
      Obra: r.proyecto ?? '',
      Chofer: r.conductor ?? '',
      Estado: this.faseLabel(r.fase),
      Artículos: r.items,
    }));
    await exportarExcel('conduces', rows);
  }
}
