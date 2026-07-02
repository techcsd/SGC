import { Component, ChangeDetectionStrategy, inject, signal, computed, OnInit } from '@angular/core';
import { RouterLink } from '@angular/router';
import { BitacoraService } from '../../../../shared/services/bitacora.service';
import { ProyectosService } from '../../../../shared/services/proyectos.service';
import { Bitacora, BitacoraArchivo } from '../../../../shared/models/bitacora.model';
import { Proyecto } from '../../../../shared/models/proyecto.model';
import { formatFechaDisplay } from '../../../../shared/utils/fecha.util';
import { FormDrawer } from '../../../../shared/components/form-drawer/form-drawer';

@Component({
  selector: 'app-bitacora-historial',
  imports: [RouterLink, FormDrawer],
  templateUrl: './historial.html',
  styleUrl: './historial.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Historial implements OnInit {
  private bitacoraService = inject(BitacoraService);
  private proyectosService = inject(ProyectosService);

  formatFecha = formatFechaDisplay;

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

  filtered = computed(() => {
    const q = this.searchQuery().toLowerCase().trim();
    const proyectoId = this.selectedProyecto();
    const from = this.dateFrom();
    const to = this.dateTo();

    return this.bitacoras().filter((b) => {
      if (
        q &&
        !b.bloque_entrepiso.toLowerCase().includes(q) &&
        !b.ingeniero_responsable.toLowerCase().includes(q)
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

  actividadesResumen(b: Bitacora): string {
    const count = b.actividades?.length ?? 0;
    return count === 0 ? 'Sin actividades' : `${count} actividad${count !== 1 ? 'es' : ''}`;
  }

  restriccionesResumen(b: Bitacora): string {
    const restricciones = b.restricciones ?? [];
    if (restricciones.length === 0) return '—';
    return restricciones.map((r) => r.tipo_restriccion).join(', ');
  }
}
