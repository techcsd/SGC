import { Component, ChangeDetectionStrategy, inject, signal, computed, OnInit } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { OtrosValoresService, OtroValorFrecuente } from '../../../../shared/services/otros-valores.service';
import { Skeleton } from '../../../../shared/components/skeleton/skeleton';
import { formatFechaRelativa } from '../../../../shared/utils/fecha.util';

interface GrupoContexto {
  contexto: string;
  valores: OtroValorFrecuente[];
}

/**
 * U25 — Inteligencia de "Otro/s". Muestra los valores de texto libre que los
 * usuarios escriben en los selectores con opción "Otro", agrupados por contexto.
 * Los que superan el umbral sugieren crear una opción oficial.
 */
@Component({
  selector: 'app-admin-otros-valores',
  imports: [Skeleton, DecimalPipe],
  templateUrl: './otros-valores.html',
  styleUrl: './otros-valores.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminOtrosValores implements OnInit {
  private service = inject(OtrosValoresService);

  formatFecha = formatFechaRelativa;

  private valores = signal<OtroValorFrecuente[]>([]);
  loading = signal(true);
  error = signal('');

  sugerencias = computed(() => this.valores().filter((v) => v.supera_umbral).length);

  grupos = computed<GrupoContexto[]>(() => {
    const map = new Map<string, OtroValorFrecuente[]>();
    for (const v of this.valores()) {
      const g = map.get(v.contexto) ?? [];
      g.push(v);
      map.set(v.contexto, g);
    }
    return [...map.entries()].map(([contexto, valores]) => ({ contexto, valores }));
  });

  async ngOnInit() {
    this.loading.set(true);
    this.error.set('');
    try {
      this.valores.set(await this.service.getFrecuentes());
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'Error al cargar los valores.');
    } finally {
      this.loading.set(false);
    }
  }

  contextoLabel(c: string): string {
    return c.replace(/\./g, ' · ').replace(/_/g, ' ');
  }
}
