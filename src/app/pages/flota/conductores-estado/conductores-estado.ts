import { Component, ChangeDetectionStrategy, inject, signal, computed, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { ConductoresService } from '../../../../shared/services/conductores.service';
import {
  ConductorStats,
  EstadoLicencia,
  ESTADO_LICENCIA_LABEL,
  ESTADO_LICENCIA_BADGE,
} from '../../../../shared/models/vehiculo-asignacion.model';
import { Skeleton } from '../../../../shared/components/skeleton/skeleton';
import { formatFechaDisplay } from '../../../../shared/utils/fecha.util';

/**
 * S25 — Dashboard "Estado de conductores": KPIs clicables (filtran la tabla),
 * búsqueda por nombre y tabla ordenada por proximidad de vencimiento de
 * licencia (vencidas/por vencer primero). Filas clicables al perfil del
 * conductor (regla Q3/R).
 */
@Component({
  selector: 'app-conductores-estado',
  imports: [Skeleton],
  templateUrl: './conductores-estado.html',
  styleUrl: './conductores-estado.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConductoresEstado implements OnInit {
  private conductoresService = inject(ConductoresService);
  private router = inject(Router);

  readonly estadoLabel = ESTADO_LICENCIA_LABEL;
  readonly estadoBadge = ESTADO_LICENCIA_BADGE;
  formatFecha = formatFechaDisplay;

  loading = signal(true);
  error = signal('');
  conductores = signal<ConductorStats[]>([]);

  // Filtros de presentación (no tocan la carga de datos)
  search = signal('');
  filtroEstado = signal<EstadoLicencia | null>(null);

  vigentes = computed(() => this.conductores().filter((c) => c.estado_licencia === 'vigente').length);
  porVencer = computed(() => this.conductores().filter((c) => c.estado_licencia === 'por_vencer').length);
  vencidas = computed(() => this.conductores().filter((c) => c.estado_licencia === 'vencida').length);
  sinDato = computed(() => this.conductores().filter((c) => c.estado_licencia === 'sin_dato').length);

  /** Filtra por estado + búsqueda y ordena por proximidad de vencimiento. */
  filtered = computed<ConductorStats[]>(() => {
    const estado = this.filtroEstado();
    const q = this.search().trim().toLowerCase();
    return this.conductores()
      .filter((c) => (estado ? c.estado_licencia === estado : true))
      .filter((c) => (q ? c.nombre.toLowerCase().includes(q) : true))
      .slice()
      .sort((a, b) => {
        // Sin fecha va al final; fechas más próximas/vencidas primero.
        if (!a.licencia_vencimiento && !b.licencia_vencimiento) return 0;
        if (!a.licencia_vencimiento) return 1;
        if (!b.licencia_vencimiento) return -1;
        return a.licencia_vencimiento.localeCompare(b.licencia_vencimiento);
      });
  });

  onSearch(value: string) {
    this.search.set(value);
  }

  /** Clic en un KPI: activa el filtro; clic en el activo lo limpia. */
  toggleFiltro(estado: EstadoLicencia) {
    this.filtroEstado.update((actual) => (actual === estado ? null : estado));
  }

  limpiarFiltros() {
    this.filtroEstado.set(null);
    this.search.set('');
  }

  /** Inicial para el avatar cuando no hay foto. */
  inicial(nombre: string): string {
    return (nombre?.trim().charAt(0) || '?').toUpperCase();
  }

  /** Navega al perfil del conductor (click o Enter en la fila). */
  abrirConductor(id: string) {
    this.router.navigate(['/flota/conductores', id]);
  }

  async ngOnInit() {
    this.loading.set(true);
    this.error.set('');
    try {
      this.conductores.set(await this.conductoresService.getEstadoConductores());
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'Error al cargar los conductores.');
    } finally {
      this.loading.set(false);
    }
  }
}
