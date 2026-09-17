import {
  Component,
  ChangeDetectionStrategy,
  input,
  output,
  computed,
  effect,
  inject,
} from '@angular/core';
import { Icon } from '../icon/icon';
import { TranslatePipe } from '../../i18n/translate.pipe';
import { UserService } from '../../../app/core/services/user.service';
import { TelemetryService } from '../../services/telemetry.service';
import { presentarError } from '../../utils/friendly-error.util';

/**
 * BS2 — estado de error honesto y por ROL. Nunca muestra jerga técnica al
 * usuario: pinta el mensaje humano de `presentarError`, ofrece "Reintentar" y,
 * SOLO si el usuario es desarrollador (`UserService.esDesarrollador()`, espejo de
 * `sgc.es_desarrollador()`), un `<details>` con el detalle técnico (SQLSTATE +
 * mensaje + sugerencia). Además REPORTA siempre el error a Tecnología vía
 * `report_app_error` (una vez por firma) — regla 16 del checklist de migraciones.
 *
 * Uso: pásale el error crudo capturado + la pantalla.
 *   @if (error()) { <app-error-state [error]="error()" pantalla="los vehículos" (retry)="loadAll()" /> }
 */
@Component({
  selector: 'app-error-state',
  imports: [Icon, TranslatePipe],
  templateUrl: './error-state.html',
  styleUrl: './error-state.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ErrorState {
  /** El error crudo capturado (Error/PostgREST/string). */
  error = input.required<unknown>();
  /** Nombre humano de la pantalla/dato ("los vehículos", "las requisiciones"). */
  pantalla = input<string>('la información');
  /** Verbo alternativo a "cargar" ("guardar el vehículo", "aprobar la requisición"). */
  accion = input<string | undefined>(undefined);
  /** Variante compacta (inline, sin tarjeta grande). */
  compact = input<boolean>(false);

  retry = output<void>();

  private users = inject(UserService);
  private telemetry = inject(TelemetryService);
  private lastReported: string | null = null;

  esDesarrollador = this.users.esDesarrollador;

  presentacion = computed(() =>
    presentarError(this.error(), { pantalla: this.pantalla(), accion: this.accion() }),
  );

  constructor() {
    // Reporta a Tecnología cada firma de error una sola vez (TelemetryService ya
    // deduplica por sesión; este guard evita reportar en cada change-detection).
    effect(() => {
      const p = this.presentacion();
      if (!p.raw || p.raw === this.lastReported) return;
      this.lastReported = p.raw;
      this.telemetry.reportCaught(p.raw, {
        pantalla: this.pantalla(),
        accion: this.accion() ?? null,
        rol: this.users.roles().join(',') || '(sin rol)',
        sqlstate: p.sqlstate,
        acceso_denegado: p.esAccesoDenegado,
      });
    });
  }

  onRetry() {
    this.retry.emit();
  }
}
