import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { PulsoSistemaEstado, PulsoSistemaFila, PulsoSistemaService } from '../../../../shared/services/pulso-sistema.service';
import { ErrorState } from '../../../../shared/ui/error-state/error-state';
import { TranslatePipe } from '../../../../shared/i18n/translate.pipe';
import { EstadoPulseDirective } from '../../../../shared/motion/estado-pulse.directive';
import { formatFechaRelativa } from '../../../../shared/utils/fecha.util';

const ESTADO_LABEL: Record<PulsoSistemaEstado, string> = {
  activo: 'Con actividad',
  sin_actividad: 'Sin actividad reciente',
  atencion: 'Necesita atención',
  error: 'Falló',
};

/**
 * F6c (ronda DF) — "Pulso del sistema": línea de vida por sistema (BD, crons,
 * cola de envíos, STT, lectores de IA, GPS) vía sgc.pulso_sistema(). Regla del
 * prompt: sin actividad reciente se ve gris/neutral, NUNCA como caído — solo
 * se marca error cuando hay una falla real y verificable.
 */
@Component({
  selector: 'app-admin-pulso-sistema',
  imports: [ErrorState, TranslatePipe, EstadoPulseDirective],
  templateUrl: './pulso-sistema.html',
  styleUrl: './pulso-sistema.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminPulsoSistema implements OnInit {
  private service = inject(PulsoSistemaService);

  readonly estadoLabel = ESTADO_LABEL;

  loading = signal(true);
  error = signal<unknown>(null);
  filas = this.service.filas;

  relativo = (fila: PulsoSistemaFila): string =>
    fila.ultima_actividad ? formatFechaRelativa(fila.ultima_actividad) : 'nunca';

  async ngOnInit() {
    await this.cargar();
  }

  async cargar(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      await this.service.cargar();
    } catch (e) {
      this.error.set(e);
    } finally {
      this.loading.set(false);
    }
  }
}
