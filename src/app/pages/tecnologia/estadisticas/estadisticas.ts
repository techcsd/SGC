import { Component, ChangeDetectionStrategy, inject, signal, computed, OnInit } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { EstadisticasService, EstadisticasUso } from '../../../../shared/services/estadisticas.service';
import { Skeleton } from '../../../../shared/components/skeleton/skeleton';
import { formatFechaHumana } from '../../../../shared/utils/fecha.util';

/**
 * AQ7 — Sistema > Estadísticas: uso de la web y la app (usuarios activos D/S/M,
 * split web-vs-app, distribución de dispositivos y versiones). Gating es_tecnologia().
 */
@Component({
  selector: 'app-tec-estadisticas',
  imports: [DecimalPipe, Skeleton],
  templateUrl: './estadisticas.html',
  styleUrl: './estadisticas.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TecEstadisticas implements OnInit {
  private service = inject(EstadisticasService);

  readonly formatFechaHora = formatFechaHumana;

  data = signal<EstadisticasUso | null>(null);
  loading = signal(true);
  error = signal('');

  // Total para calcular porcentajes de la distribución de dispositivos.
  private totalDispositivos = computed(() =>
    (this.data()?.dispositivos ?? []).reduce((s, d) => s + d.total, 0),
  );

  pctDispositivo(total: number): number {
    const t = this.totalDispositivos();
    return t > 0 ? Math.round((100 * total) / t) : 0;
  }

  plataformaLabel(p: string): string {
    switch (p) {
      case 'android': return 'Android (app)';
      case 'ios': return 'iPhone (app)';
      case 'ios-pwa': return 'iPhone (PWA)';
      case 'web': return 'Web';
      default: return p;
    }
  }

  async ngOnInit() {
    this.loading.set(true);
    this.error.set('');
    try {
      this.data.set(await this.service.getUso());
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'No se pudieron cargar las estadísticas.');
    } finally {
      this.loading.set(false);
    }
  }
}
