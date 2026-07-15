import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { AppVersionesService } from '../../../../shared/services/app-versiones.service';
import { AppVersion, CambioItem, CambioTag, CAMBIO_META, Plataforma } from '../../../../shared/models/app-version.model';
import { Skeleton } from '../../../../shared/components/skeleton/skeleton';
import { formatFechaDisplay } from '../../../../shared/utils/fecha.util';

const TAGS: CambioTag[] = ['nuevo', 'mejora', 'arreglo', 'seguridad'];

interface VersionVista extends AppVersion {
  cambiosVisibles: CambioItem[];
}

/**
 * Historial de versiones (línea de tiempo) de la plataforma. Solo admin.
 * Por plataforma (web / app móvil): cada versión con su fecha, los cambios
 * etiquetados (nuevo/mejora/arreglo/seguridad) y una acción — web: abrir esa
 * versión del sitio; móvil: descargar ese APK. Filtro por tipo de cambio.
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
  readonly TAGS = TAGS;
  readonly CAMBIO_META = CAMBIO_META;

  private todas = signal<AppVersion[]>([]);
  loading = signal(true);
  error = signal('');
  plataforma = signal<Plataforma>('web');
  filtro = signal<CambioTag | null>(null);

  totalWeb = computed(() => this.todas().filter((v) => v.plataforma === 'web').length);
  totalMovil = computed(() => this.todas().filter((v) => v.plataforma === 'movil').length);

  /** Versiones de la plataforma activa, aplicando el filtro de tipo de cambio. */
  versiones = computed<VersionVista[]>(() => {
    const f = this.filtro();
    return this.todas()
      .filter((v) => v.plataforma === this.plataforma())
      .map((v) => ({
        ...v,
        cambiosVisibles: f ? (v.cambios ?? []).filter((c) => c.t === f) : (v.cambios ?? []),
      }))
      // Sin filtro: mostrar TODAS (incluye versiones auto-registradas que solo
      // traen `notas` y aún no tienen cambios etiquetados). Con filtro activo:
      // solo las que tienen cambios de ese tipo.
      .filter((v) => (f ? v.cambiosVisibles.length > 0 : true));
  });

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
    this.filtro.set(null);
  }

  toggleFiltro(t: CambioTag) {
    this.filtro.update((f) => (f === t ? null : t));
  }

  tagLabel(t: string): string {
    return CAMBIO_META[t]?.label ?? t;
  }
}
