import { Component, ChangeDetectionStrategy, inject, signal, computed, OnInit } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { ProyectosService, KpiProyectoRaw } from '../../../../shared/services/proyectos.service';
import { BarChart, BarDatum } from '../../../../shared/ui/bar-chart/bar-chart';
import { DonutChart, DonutDatum } from '../../../../shared/ui/donut-chart/donut-chart';
import { Skeleton } from '../../../../shared/components/skeleton/skeleton';

// Score weights (sum = 1). Tunable here without a migration.
const PESO_AVANCE = 0.3;
const PESO_BITACORA = 0.25;
const PESO_SEGURIDAD = 0.25;
const PESO_PRESUPUESTO = 0.2;

// A month of consistent daily reporting ≈ 20 working days.
const BITACORA_META_30D = 20;
// Each incident in the last 90 days knocks this many points off the safety score.
const PENALIZACION_INCIDENTE = 25;

interface KpiProyecto extends KpiProyectoRaw {
  scoreAvance: number;
  scoreBitacora: number;
  scoreSeguridad: number;
  scorePresupuesto: number;
  scoreTotal: number;
  posicion: number;
}

@Component({
  selector: 'app-proyectos-kpi',
  imports: [DecimalPipe, BarChart, DonutChart, Skeleton],
  templateUrl: './kpi.html',
  styleUrl: './kpi.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Kpi implements OnInit {
  private proyectosService = inject(ProyectosService);

  loading = signal(true);
  error = signal('');
  private raw = signal<KpiProyectoRaw[]>([]);

  ranking = computed<KpiProyecto[]>(() => {
    const scored = this.raw().map((r) => {
      const scoreAvance = clamp(Number(r.avance_promedio));
      const scoreBitacora = clamp((r.bitacoras_30d / BITACORA_META_30D) * 100);
      const scoreSeguridad = clamp(100 - r.incidentes_90d * PENALIZACION_INCIDENTE);
      const scorePresupuesto = this.presupuestoScore(r);
      const scoreTotal =
        scoreAvance * PESO_AVANCE +
        scoreBitacora * PESO_BITACORA +
        scoreSeguridad * PESO_SEGURIDAD +
        scorePresupuesto * PESO_PRESUPUESTO;
      return { ...r, scoreAvance, scoreBitacora, scoreSeguridad, scorePresupuesto, scoreTotal, posicion: 0 };
    });
    scored.sort((a, b) => b.scoreTotal - a.scoreTotal);
    scored.forEach((s, i) => (s.posicion = i + 1));
    return scored;
  });

  // Bar chart: total score per project.
  scoreBars = computed<BarDatum[]>(() =>
    this.ranking().map((k) => ({
      label: k.nombre,
      value: k.scoreTotal,
      color:
        k.scoreTotal >= 80 ? 'var(--sgc-success)' : k.scoreTotal >= 50 ? 'var(--sgc-warning)' : 'var(--sgc-danger)',
    })),
  );

  // Donut: performance distribution across projects.
  desempenoDonut = computed<DonutDatum[]>(() => {
    const r = this.ranking();
    return [
      { label: 'Buen desempeño (80+)', value: r.filter((k) => k.scoreTotal >= 80).length, color: 'var(--sgc-success)' },
      { label: 'Aceptable (50-79)', value: r.filter((k) => k.scoreTotal >= 50 && k.scoreTotal < 80).length, color: 'var(--sgc-warning)' },
      { label: 'Necesita atención (<50)', value: r.filter((k) => k.scoreTotal < 50).length, color: 'var(--sgc-danger)' },
    ];
  });

  incidentesBars = computed<BarDatum[]>(() =>
    this.ranking()
      .filter((k) => k.incidentes_90d > 0)
      .map((k) => ({ label: k.nombre, value: k.incidentes_90d, color: 'var(--sgc-danger)' })),
  );

  private presupuestoScore(r: KpiProyectoRaw): number {
    // No budget set → neutral (don't reward or punish).
    if (!r.presupuesto || r.presupuesto <= 0) return 70;
    if (r.gasto_real <= r.presupuesto) return 100;
    const excesoPct = ((r.gasto_real - r.presupuesto) / r.presupuesto) * 100;
    return clamp(100 - excesoPct);
  }

  async ngOnInit() {
    this.loading.set(true);
    this.error.set('');
    try {
      this.raw.set(await this.proyectosService.getKpiProyectos());
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'Error al cargar el ranking.');
    } finally {
      this.loading.set(false);
    }
  }

  scoreClass(score: number): string {
    if (score >= 80) return 'score--good';
    if (score >= 50) return 'score--mid';
    return 'score--low';
  }

  medalla(posicion: number): string {
    switch (posicion) {
      case 1: return '🥇';
      case 2: return '🥈';
      case 3: return '🥉';
      default: return `${posicion}`;
    }
  }
}

function clamp(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}
