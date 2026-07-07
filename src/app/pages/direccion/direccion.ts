import { Component, ChangeDetectionStrategy, inject, signal, computed, OnInit } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { SupabaseService } from '../../core/services/supabase.service';
import { ProyectosService, KpiProyectoRaw } from '../../../shared/services/proyectos.service';
import { BarChart, BarDatum } from '../../../shared/ui/bar-chart/bar-chart';
import { DonutChart, DonutDatum } from '../../../shared/ui/donut-chart/donut-chart';

@Component({
  selector: 'app-direccion',
  imports: [DecimalPipe, BarChart, DonutChart],
  templateUrl: './direccion.html',
  styleUrl: './direccion.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Direccion implements OnInit {
  private supabase = inject(SupabaseService);
  private proyectosService = inject(ProyectosService);

  loading = signal(true);
  error = signal('');

  private kpi = signal<KpiProyectoRaw[]>([]);
  private proyectosEstado = signal<{ estado: string }[]>([]);
  private tareasEstado = signal<{ estado: string }[]>([]);
  empleadosActivos = signal(0);
  expedientesAbiertos = signal(0);

  // ── Stat tiles ───────────────────────────────────────────
  proyectosActivos = computed(() => this.kpi().length);
  incidentesTotal = computed(() => this.kpi().reduce((s, k) => s + k.incidentes_90d, 0));
  presupuestoTotal = computed(() => this.kpi().reduce((s, k) => s + Number(k.presupuesto ?? 0), 0));
  gastoTotal = computed(() => this.kpi().reduce((s, k) => s + Number(k.gasto_real ?? 0), 0));

  // ── Charts ───────────────────────────────────────────────
  proyectosPorEstado = computed<DonutDatum[]>(() => {
    const colors: Record<string, string> = {
      planificacion: '#64748b', en_progreso: '#1F4E79', pausado: '#B45309', completado: '#2D7D46', cancelado: '#C0392B',
    };
    const labels: Record<string, string> = {
      planificacion: 'Planificación', en_progreso: 'En progreso', pausado: 'Pausado', completado: 'Completado', cancelado: 'Cancelado',
    };
    return this.groupCount(this.proyectosEstado().map((p) => p.estado)).map((g) => ({
      label: labels[g.key] ?? g.key,
      value: g.count,
      color: colors[g.key] ?? '#94a3b8',
    }));
  });

  tareasPorEstado = computed<DonutDatum[]>(() => {
    const colors: Record<string, string> = {
      pendiente: '#64748b', en_progreso: '#1F4E79', completada: '#2D7D46', cancelada: '#C0392B',
    };
    const labels: Record<string, string> = {
      pendiente: 'Pendiente', en_progreso: 'En progreso', completada: 'Completada', cancelada: 'Cancelada',
    };
    return this.groupCount(this.tareasEstado().map((t) => t.estado)).map((g) => ({
      label: labels[g.key] ?? g.key,
      value: g.count,
      color: colors[g.key] ?? '#94a3b8',
    }));
  });

  scoresBars = computed<BarDatum[]>(() =>
    [...this.kpi()]
      .map((k) => ({
        nombre: k.nombre,
        score: scoreTotal(k),
      }))
      .sort((a, b) => b.score - a.score)
      .map((k) => ({
        label: k.nombre,
        value: k.score,
        color: k.score >= 80 ? 'var(--sgc-success)' : k.score >= 50 ? 'var(--sgc-warning)' : 'var(--sgc-danger)',
      })),
  );

  async ngOnInit() {
    this.loading.set(true);
    this.error.set('');
    try {
      const [kpi, proyectos, tareas, empleados, expedientes] = await Promise.all([
        this.proyectosService.getKpiProyectos(),
        this.supabase.client.from('proyectos').select('estado').eq('activo', true),
        this.supabase.client.from('tareas').select('estado'),
        this.supabase.client.from('empleados').select('id', { count: 'exact', head: true }).eq('activo', true),
        this.supabase.client.from('expedientes_legales').select('id', { count: 'exact', head: true }).neq('estado', 'cerrado'),
      ]);
      this.kpi.set(kpi);
      this.proyectosEstado.set((proyectos.data ?? []) as { estado: string }[]);
      this.tareasEstado.set((tareas.data ?? []) as { estado: string }[]);
      this.empleadosActivos.set(empleados.count ?? 0);
      this.expedientesAbiertos.set(expedientes.count ?? 0);
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'Error al cargar el panel de dirección.');
    } finally {
      this.loading.set(false);
    }
  }

  private groupCount(values: string[]): { key: string; count: number }[] {
    const map = new Map<string, number>();
    for (const v of values) map.set(v, (map.get(v) ?? 0) + 1);
    return [...map.entries()].map(([key, count]) => ({ key, count }));
  }
}

// Same weighting as the Ranking de Encargados page.
function scoreTotal(k: KpiProyectoRaw): number {
  const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
  const avance = clamp(Number(k.avance_promedio));
  const bitacora = clamp((k.bitacoras_30d / 20) * 100);
  const seguridad = clamp(100 - k.incidentes_90d * 25);
  let presupuesto = 70;
  if (k.presupuesto && k.presupuesto > 0) {
    presupuesto = k.gasto_real <= k.presupuesto ? 100 : clamp(100 - ((k.gasto_real - k.presupuesto) / k.presupuesto) * 100);
  }
  return Math.round(avance * 0.3 + bitacora * 0.25 + seguridad * 0.25 + presupuesto * 0.2);
}
