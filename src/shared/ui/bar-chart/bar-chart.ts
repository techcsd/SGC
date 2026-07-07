import { Component, ChangeDetectionStrategy, input, computed } from '@angular/core';

export interface BarDatum {
  label: string;
  value: number;
  color?: string;
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

  private max = computed(() => Math.max(1, ...this.data().map((d) => d.value)));

  bars = computed(() =>
    this.data().map((d) => ({
      ...d,
      pct: (d.value / this.max()) * 100,
      color: d.color ?? 'var(--sgc-primary)',
    })),
  );
}
