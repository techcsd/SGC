import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { AppVersionesService } from '../../../../shared/services/app-versiones.service';
import { AppVersion, Plataforma } from '../../../../shared/models/app-version.model';
import { Skeleton } from '../../../../shared/components/skeleton/skeleton';
import { formatFechaDisplay } from '../../../../shared/utils/fecha.util';

/**
 * Historial de versiones (línea de tiempo) de la plataforma. Solo admin (la ruta
 * está bajo /admin, gated por moduleGuard('admin')). Muestra, por plataforma
 * (web / app móvil), cada versión con su fecha y los cambios/mejoras que trajo.
 */
@Component({
  selector: 'app-historial-versiones',
  imports: [Skeleton],
  templateUrl: './historial-versiones.html',
  styleUrl: './historial-versiones.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminHistorialVersiones implements OnInit {
  private service = inject(AppVersionesService);

  formatFecha = formatFechaDisplay;

  private todas = signal<AppVersion[]>([]);
  loading = signal(true);
  error = signal('');
  plataforma = signal<Plataforma>('web');

  /** Versiones de la plataforma activa (ya vienen ordenadas fecha desc). */
  versiones = computed(() => this.todas().filter((v) => v.plataforma === this.plataforma()));

  totalWeb = computed(() => this.todas().filter((v) => v.plataforma === 'web').length);
  totalMovil = computed(() => this.todas().filter((v) => v.plataforma === 'movil').length);

  async ngOnInit() {
    this.loading.set(true);
    this.error.set('');
    try {
      this.todas.set(await this.service.getHistorial());
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'Error al cargar el historial.');
    } finally {
      this.loading.set(false);
    }
  }

  setPlataforma(p: Plataforma) {
    this.plataforma.set(p);
  }
}
