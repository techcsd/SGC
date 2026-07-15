import { Component, ChangeDetectionStrategy, inject, signal, computed, OnInit } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { ProyectosService } from '../../../../shared/services/proyectos.service';
import { Proyecto, PROYECTO_ESTADOS, PROYECTO_TIPOS } from '../../../../shared/models/proyecto.model';
import { DonutChart, DonutDatum } from '../../../../shared/ui/donut-chart/donut-chart';
import { BarChart, BarDatum } from '../../../../shared/ui/bar-chart/bar-chart';
import { Skeleton } from '../../../../shared/components/skeleton/skeleton';

@Component({
  selector: 'app-proyectos-historial',
  imports: [DatePipe, DecimalPipe, DonutChart, BarChart, Skeleton],
  templateUrl: './historial.html',
  styleUrl: './historial.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProyectosHistorial implements OnInit {
  private proyectosService = inject(ProyectosService);

  proyectos = signal<Proyecto[]>([]);
  loading = signal(true);
  error = signal('');
  tab = signal<'finalizados' | 'todos'>('finalizados');

  finalizados = computed(() => this.proyectos().filter((p) => p.estado === 'completado' || p.estado === 'cancelado'));

  visibles = computed(() => {
    const base = this.tab() === 'finalizados' ? this.finalizados() : this.proyectos();
    return [...base].sort((a, b) => (b.fecha_fin_real ?? b.created_at).localeCompare(a.fecha_fin_real ?? a.created_at));
  });

  totalCompletados = computed(() => this.proyectos().filter((p) => p.estado === 'completado').length);
  totalCancelados = computed(() => this.proyectos().filter((p) => p.estado === 'cancelado').length);
  totalActivos = computed(() => this.proyectos().filter((p) => p.estado === 'en_progreso').length);

  porEstado = computed<DonutDatum[]>(() => {
    const colors: Record<string, string> = {
      planificacion: '#64748b', en_progreso: '#1F4E79', pausado: '#B45309', completado: '#2D7D46', cancelado: '#C0392B',
    };
    return PROYECTO_ESTADOS.map((e) => ({
      label: e.label,
      value: this.proyectos().filter((p) => p.estado === e.value).length,
      color: colors[e.value] ?? '#94a3b8',
    })).filter((d) => d.value > 0);
  });

  porTipo = computed<BarDatum[]>(() =>
    PROYECTO_TIPOS.map((t) => ({
      label: t.label,
      value: this.proyectos().filter((p) => p.tipo === t.value).length,
    })).filter((d) => d.value > 0),
  );

  async ngOnInit() {
    this.loading.set(true);
    this.error.set('');
    try {
      this.proyectos.set(await this.proyectosService.getAll());
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'Error al cargar el historial.');
    } finally {
      this.loading.set(false);
    }
  }

  setTab(t: 'finalizados' | 'todos') {
    this.tab.set(t);
  }

  estadoLabel(v: string): string {
    return PROYECTO_ESTADOS.find((e) => e.value === v)?.label ?? v;
  }
  estadoBadge(v: string): string {
    return 'sgc-badge sgc-badge--' + (PROYECTO_ESTADOS.find((e) => e.value === v)?.badge ?? 'neutral');
  }
  tipoLabel(v: string | null): string {
    return PROYECTO_TIPOS.find((t) => t.value === v)?.label ?? (v ?? '—');
  }

  /** Duration in days from start to real end (or '—'). */
  duracion(p: Proyecto): string {
    if (!p.fecha_inicio || !p.fecha_fin_real) return '—';
    const [y1, m1, d1] = p.fecha_inicio.split('-').map(Number);
    const [y2, m2, d2] = p.fecha_fin_real.split('-').map(Number);
    const dias = Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
    return dias >= 0 ? `${dias} días` : '—';
  }
}
