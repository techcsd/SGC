import { Component, ChangeDetectionStrategy, input, output, computed } from '@angular/core';
import { DecimalPipe } from '@angular/common';

export interface DonutDatum {
  label: string;
  value: number;
  color: string;
  /** Q9 — clave opcional para drill-down (si no se da, se emite el label). */
  key?: string;
}

interface Arc {
  label: string;
  value: number;
  color: string;
  dasharray: string;
  dashoffset: number;
  pct: number;
  key?: string;
}

/** Lightweight dependency-free donut/pie chart (SVG stroke-dasharray arcs). */
@Component({
  selector: 'app-donut-chart',
  imports: [DecimalPipe],
  templateUrl: './donut-chart.html',
  styleUrl: './donut-chart.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DonutChart {
  data = input<DonutDatum[]>([]);
  titulo = input<string>('');
  /** Q9 — habilita clic por segmento (drill-down desde la leyenda). */
  selectable = input<boolean>(false);
  /** Q9 — emite la clave (o el label) del segmento clicado. */
  select = output<string>();

  readonly radius = 60;
  readonly circumference = 2 * Math.PI * 60;

  total = computed(() => this.data().reduce((s, d) => s + d.value, 0));

  arcs = computed<Arc[]>(() => {
    const total = this.total();
    if (total <= 0) return [];
    let offset = 0;
    return this.data()
      .filter((d) => d.value > 0)
      .map((d) => {
        const pct = d.value / total;
        const len = pct * this.circumference;
        const arc: Arc = {
          label: d.label,
          value: d.value,
          color: d.color,
          dasharray: `${len} ${this.circumference - len}`,
          dashoffset: -offset,
          pct: pct * 100,
          key: d.key,
        };
        offset += len;
        return arc;
      });
  });

  onSelect(a: Arc) {
    if (this.selectable()) this.select.emit(a.key ?? a.label);
  }
}
