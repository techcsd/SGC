import { Component, ChangeDetectionStrategy, inject, signal, computed, OnInit } from '@angular/core';
import { RouterLink } from '@angular/router';
import { SalidasService } from '../../../../shared/services/salidas.service';
import {
  SalidaInventario,
  SalidaEstado,
  SALIDA_ESTADO_LABELS,
  conduceNumero,
} from '../../../../shared/models/salida.model';
import { formatFechaDisplay } from '../../../../shared/utils/fecha.util';
import { exportarExcel } from '../../../../shared/utils/exportar-excel.util';
import { Skeleton } from '../../../../shared/components/skeleton/skeleton';

@Component({
  selector: 'app-conduces',
  imports: [RouterLink, Skeleton],
  templateUrl: './conduces.html',
  styleUrl: './conduces.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Conduces implements OnInit {
  private salidasService = inject(SalidasService);

  formatFecha = formatFechaDisplay;
  readonly ESTADO_LABELS = SALIDA_ESTADO_LABELS;
  readonly numero = conduceNumero;

  salidas = signal<SalidaInventario[]>([]);
  loading = signal(true);
  error = signal('');

  searchQuery = signal('');
  selectedEstado = signal<string>('');

  currentPage = signal(1);
  readonly PAGE_SIZE = 20;

  filtered = computed(() => {
    const q = this.searchQuery().toLowerCase().trim();
    const estado = this.selectedEstado();
    return this.salidas().filter((s) => {
      if (estado && s.estado !== estado) return false;
      if (q) {
        const haystack = [
          this.numero(s.id),
          s.proyecto?.nombre ?? '',
          s.responsable ?? '',
          s.bodega?.nombre ?? '',
        ]
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

  totalPages = computed(() => Math.ceil(this.filtered().length / this.PAGE_SIZE));

  hasActiveFilters = computed(() => !!this.searchQuery() || !!this.selectedEstado());

  readonly ESTADOS: { value: SalidaEstado; label: string }[] = (
    Object.keys(SALIDA_ESTADO_LABELS) as SalidaEstado[]
  ).map((value) => ({ value, label: SALIDA_ESTADO_LABELS[value] }));

  async ngOnInit() {
    this.loading.set(true);
    this.error.set('');
    try {
      this.salidas.set(await this.salidasService.getAll());
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'Error al cargar los conduces.');
    } finally {
      this.loading.set(false);
    }
  }

  estadoModifier(estado: SalidaEstado): string {
    return estado === 'entregado'
      ? 'success'
      : estado === 'entregado_incompleto'
        ? 'danger'
        : 'warning';
  }

  itemsCount(s: SalidaInventario): number {
    return (s.detalle_salidas ?? []).length;
  }

  onSearch(value: string) {
    this.searchQuery.set(value);
    this.currentPage.set(1);
  }

  onEstadoChange(value: string) {
    this.selectedEstado.set(value);
    this.currentPage.set(1);
  }

  clearFilters() {
    this.searchQuery.set('');
    this.selectedEstado.set('');
    this.currentPage.set(1);
  }

  goToPage(page: number) {
    if (page >= 1 && page <= this.totalPages()) this.currentPage.set(page);
  }

  get pages(): number[] {
    return Array.from({ length: this.totalPages() }, (_, i) => i + 1);
  }

  /** Exporta los conduces filtrados a Excel. */
  async exportar() {
    const rows = this.filtered().map((s) => ({
      'No. Conduce': this.numero(s.id),
      Fecha: this.formatFecha(s.fecha),
      Almacén: s.bodega?.nombre ?? '',
      Proyecto: s.proyecto?.nombre ?? '',
      Estado: this.ESTADO_LABELS[s.estado],
      Artículos: this.itemsCount(s),
    }));
    await exportarExcel('conduces', rows);
  }
}
