import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { IncentivosService, MiRendimientoSemana, RENGLON_LABELS } from '../../../shared/services/incentivos.service';
import { Skeleton } from '../../../shared/components/skeleton/skeleton';
import { formatFechaDisplay } from '../../../shared/utils/fecha.util';

// AT2 — "Mi rendimiento": el chofer ve SOLO su propio puntaje semanal e histórico
// (no ve el módulo Incentivos). La RLS garantiza que solo llegan sus filas.
@Component({
  selector: 'app-mi-rendimiento',
  imports: [Skeleton],
  templateUrl: './mi-rendimiento.html',
  styleUrl: './mi-rendimiento.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MiRendimiento implements OnInit {
  private service = inject(IncentivosService);

  readonly RENGLON_LABELS = RENGLON_LABELS;
  readonly renglones = Object.keys(RENGLON_LABELS);
  readonly formatFecha = formatFechaDisplay;

  semanas = signal<MiRendimientoSemana[]>([]);
  loading = signal(true);
  error = signal('');
  expandido = signal<string | null>(null);

  actual = computed(() => this.semanas()[0] ?? null);

  async ngOnInit() {
    try {
      this.semanas.set(await this.service.miRendimiento());
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'No se pudo cargar tu rendimiento.');
    } finally {
      this.loading.set(false);
    }
  }

  toggle(id: string) { this.expandido.update((v) => (v === id ? null : id)); }
  conteoDe(s: MiRendimientoSemana, r: string) { return s.conteos?.[r] ?? null; }
  progreso(s: MiRendimientoSemana): number {
    if (!s.minimo) return 100;
    return Math.min(100, Math.round((s.puntaje / s.minimo) * 100));
  }
}
