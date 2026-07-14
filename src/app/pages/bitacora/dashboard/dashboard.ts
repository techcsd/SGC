import { Component, ChangeDetectionStrategy, inject, signal, computed, OnInit } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { BitacoraService } from '../../../../shared/services/bitacora.service';
import { Bitacora } from '../../../../shared/models/bitacora.model';
import { BarChart, BarDatum } from '../../../../shared/ui/bar-chart/bar-chart';
import { DonutChart, DonutDatum } from '../../../../shared/ui/donut-chart/donut-chart';
import { Skeleton } from '../../../../shared/components/skeleton/skeleton';

const CAT = ['#1F4E79', '#2D7D46', '#B45309', '#5B3A8E', '#0E7490', '#C0392B', '#64748b'];
const GRAVEDAD_COLOR: Record<string, string> = {
  leve: '#2D7D46', moderado: '#B45309', grave: '#C0392B', critico: '#7c1d1d',
};
const GRAVEDAD_LABEL: Record<string, string> = {
  leve: 'Leve', moderado: 'Moderado', grave: 'Grave', critico: 'Crítico',
};

/** U14 — Dashboard de bitácoras: métricas agregadas de los partes/visitas/incidentes. */
@Component({
  selector: 'app-bitacora-dashboard',
  imports: [DecimalPipe, BarChart, DonutChart, Skeleton],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BitacoraDashboard implements OnInit {
  private bitacoraService = inject(BitacoraService);

  private bitacoras = signal<Bitacora[]>([]);
  loading = signal(true);
  error = signal('');

  total = computed(() => this.bitacoras().length);
  partes = computed(() => this.bitacoras().filter((b) => b.tipo === 'parte_diario').length);
  visitas = computed(() => this.bitacoras().filter((b) => b.tipo === 'visita').length);
  incidentes = computed(() => this.bitacoras().filter((b) => b.tipo === 'incidente').length);
  diasLluvia = computed(() => this.bitacoras().filter((b) => b.llovio === true).length);
  obrerosMigracion = computed(() =>
    this.bitacoras().reduce((acc, b) => acc + (Array.isArray(b.migracion_obreros) ? b.migracion_obreros.length : 0), 0),
  );

  private groupCount(values: string[]): { key: string; count: number }[] {
    const map = new Map<string, number>();
    for (const v of values) map.set(v, (map.get(v) ?? 0) + 1);
    return [...map.entries()].sort((a, b) => b[1] - a[1]).map(([key, count]) => ({ key, count }));
  }

  /** Donut: bitácoras por tipo. */
  porTipo = computed<DonutDatum[]>(() => {
    const label: Record<string, string> = { parte_diario: 'Parte diario', visita: 'Visita', incidente: 'Incidente' };
    const color: Record<string, string> = { parte_diario: '#1F4E79', visita: '#0E7490', incidente: '#C0392B' };
    return this.groupCount(this.bitacoras().map((b) => b.tipo)).map((g) => ({
      label: label[g.key] ?? g.key, value: g.count, color: color[g.key] ?? '#64748b',
    }));
  });

  /** Bar: bitácoras por obra (top 10). */
  porObra = computed<BarDatum[]>(() =>
    this.groupCount(this.bitacoras().map((b) => b.proyecto?.nombre ?? 'Sin obra'))
      .slice(0, 10)
      .map((g, i) => ({ label: g.key, value: g.count, color: CAT[i % CAT.length] })),
  );

  /** Donut: incidencias por gravedad. */
  porGravedad = computed<DonutDatum[]>(() =>
    this.groupCount(
      this.bitacoras().filter((b) => b.tipo === 'incidente' && b.incidente_gravedad).map((b) => b.incidente_gravedad as string),
    ).map((g) => ({ label: GRAVEDAD_LABEL[g.key] ?? g.key, value: g.count, color: GRAVEDAD_COLOR[g.key] ?? '#64748b' })),
  );

  /** Bar: restricciones por tipo (todas las bitácoras). */
  porRestriccion = computed<BarDatum[]>(() => {
    const all = this.bitacoras().flatMap((b) => (b.restricciones ?? []).map((r) => r.tipo_restriccion));
    return this.groupCount(all)
      .filter((g) => g.key !== 'NINGUNA')
      .slice(0, 8)
      .map((g, i) => ({ label: g.key, value: g.count, color: CAT[i % CAT.length] }));
  });

  async ngOnInit() {
    this.loading.set(true);
    this.error.set('');
    try {
      this.bitacoras.set(await this.bitacoraService.getAll());
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'Error al cargar las bitácoras.');
    } finally {
      this.loading.set(false);
    }
  }
}
