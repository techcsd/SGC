import { Component, ChangeDetectionStrategy, input, output, computed } from '@angular/core';

export interface BarDatum {
  label: string;
  value: number;
  color?: string;
  /** Q9 — clave opcional para drill-down (si no se da, se emite el label). */
  key?: string;
}

/** Lightweight dependency-free horizontal bar chart. */
@Component({
  selector: 'app-bar-chart',
  imports: [],
  templateUrl: './bar-chart.html',
  styleUrl: './bar-chart.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BarChart {
  data = input<BarDatum[]>([]);
  titulo = input<string>('');
  /** Optional suffix shown after each value (e.g. "%"). */
  sufijo = input<string>('');
  /** Q9 — habilita clic por barra (drill-down). */
  selectable = input<boolean>(false);
  /** Q9 — emite la clave (o el label) de la barra clicada. */
  select = output<string>();

  private max = computed(() => Math.max(1, ...this.data().map((d) => d.value)));

  bars = computed(() =>
    this.data().map((d) => ({
      ...d,
      pct: (d.value / this.max()) * 100,
      color: d.color ?? 'var(--sgc-primary)',
    })),
  );

  onSelect(b: BarDatum) {
    if (this.selectable()) this.select.emit(b.key ?? b.label);
  }
}
