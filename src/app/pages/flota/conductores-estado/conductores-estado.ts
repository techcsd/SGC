import { Component, ChangeDetectionStrategy, inject, signal, computed, OnInit } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ConductoresService } from '../../../../shared/services/conductores.service';
import {
  ConductorStats,
  ESTADO_LICENCIA_LABEL,
  ESTADO_LICENCIA_BADGE,
} from '../../../../shared/models/vehiculo-asignacion.model';
import { Skeleton } from '../../../../shared/components/skeleton/skeleton';
import { formatFechaDisplay } from '../../../../shared/utils/fecha.util';

/**
 * S25 — Dashboard "Estado de conductores": tabla ordenada por proximidad de
 * vencimiento de licencia + KPIs (vigentes / por vencer / vencidas). Filas
 * clicables al perfil del conductor (regla Q3/R).
 */
@Component({
  selector: 'app-conductores-estado',
  imports: [RouterLink, Skeleton],
  templateUrl: './conductores-estado.html',
  styleUrl: './conductores-estado.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConductoresEstado implements OnInit {
  private conductoresService = inject(ConductoresService);

  readonly estadoLabel = ESTADO_LICENCIA_LABEL;
  readonly estadoBadge = ESTADO_LICENCIA_BADGE;
  formatFecha = formatFechaDisplay;

  loading = signal(true);
  error = signal('');
  conductores = signal<ConductorStats[]>([]);

  vigentes = computed(() => this.conductores().filter((c) => c.estado_licencia === 'vigente').length);
  porVencer = computed(() => this.conductores().filter((c) => c.estado_licencia === 'por_vencer').length);
  vencidas = computed(() => this.conductores().filter((c) => c.estado_licencia === 'vencida').length);

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
