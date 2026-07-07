import { Component, ChangeDetectionStrategy, inject, signal, computed, OnInit } from '@angular/core';
import { DatePipe } from '@angular/common';
import { WeatherBiService, ReporteClima } from '../../../../shared/context/weather-bi.service';
import { BarChart, BarDatum } from '../../../../shared/ui/bar-chart/bar-chart';
import { daysAgoIso, todayIso } from '../../../../shared/utils/fecha.util';

type RangoDias = 7 | 30 | 90;

@Component({
  selector: 'app-proyectos-clima',
  imports: [DatePipe, BarChart],
  templateUrl: './clima.html',
  styleUrl: './clima.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProyectosClima implements OnInit {
  private bi = inject(WeatherBiService);

  reporte = signal<ReporteClima | null>(null);
  loading = signal(true);
  error = signal('');
  rango = signal<RangoDias>(30);

  diasAdversosBars = computed<BarDatum[]>(() =>
    (this.reporte()?.porObra ?? [])
      .filter((o) => o.diasAdversos > 0)
      .map((o) => ({
        label: o.nombre,
        value: o.diasAdversos,
        color: o.pctAdverso >= 50 ? 'var(--sgc-danger)' : o.pctAdverso >= 25 ? 'var(--sgc-warning)' : 'var(--sgc-primary)',
      })),
  );

  async ngOnInit() {
    await this.cargar();
  }

  async setRango(d: RangoDias) {
    if (this.rango() === d) return;
    this.rango.set(d);
    await this.cargar();
  }

  private async cargar() {
    this.loading.set(true);
    this.error.set('');
    try {
      const hasta = todayIso();
      const desde = daysAgoIso(this.rango() - 1);
      this.reporte.set(await this.bi.getReporteClima(desde, hasta));
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'No se pudo cargar el reporte de clima.');
    } finally {
      this.loading.set(false);
    }
  }
}
