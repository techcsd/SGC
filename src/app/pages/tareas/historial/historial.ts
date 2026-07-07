import { Component, ChangeDetectionStrategy, inject, signal, computed, OnInit } from '@angular/core';
import { DatePipe } from '@angular/common';
import { TareasService } from '../../../../shared/services/tareas.service';
import { UserService } from '../../../core/services/user.service';
import { Tarea, TareaEstado, TAREA_ESTADOS, TAREA_PRIORIDADES } from '../../../../shared/models/tarea.model';
import { TareaDetalle } from '../../../../shared/components/tarea-detalle/tarea-detalle';
import { DonutChart, DonutDatum } from '../../../../shared/ui/donut-chart/donut-chart';
import { BarChart, BarDatum } from '../../../../shared/ui/bar-chart/bar-chart';

@Component({
  selector: 'app-tareas-historial',
  imports: [DatePipe, TareaDetalle, DonutChart, BarChart],
  templateUrl: './historial.html',
  styleUrl: './historial.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TareasHistorial implements OnInit {
  private tareasService = inject(TareasService);
  private userService = inject(UserService);

  readonly ESTADOS = TAREA_ESTADOS;
  readonly PRIORIDADES = TAREA_PRIORIDADES;

  // Managers (tareas module / admin) see the whole system history; everyone
  // else sees only their own (RLS also enforces this server-side).
  esGestor = this.userService.hasModulo('tareas') || this.userService.hasRole('admin');

  tareas = signal<Tarea[]>([]);
  loading = signal(true);
  error = signal('');

  searchQuery = signal('');
  selectedEstado = signal<string>('all');
  selectedPrioridad = signal<string>('all');

  detailOpen = signal(false);
  detailTarea = signal<Tarea | null>(null);

  filtered = computed(() => {
    const q = this.searchQuery().toLowerCase().trim();
    const estado = this.selectedEstado();
    const prioridad = this.selectedPrioridad();
    return this.tareas().filter((t) => {
      if (q && !t.titulo.toLowerCase().includes(q) && !(t.asignado?.nombre ?? '').toLowerCase().includes(q)) return false;
      if (estado !== 'all' && t.estado !== estado) return false;
      if (prioridad !== 'all' && t.prioridad !== prioridad) return false;
      return true;
    });
  });

  // ── Charts ───────────────────────────────────────────────
  porEstado = computed<DonutDatum[]>(() => {
    const colors: Record<string, string> = {
      pendiente: '#64748b', en_progreso: '#1F4E79', completada: '#2D7D46', cancelada: '#C0392B',
    };
    return this.ESTADOS.map((e) => ({
      label: e.label,
      value: this.tareas().filter((t) => t.estado === e.value).length,
      color: colors[e.value] ?? '#94a3b8',
    })).filter((d) => d.value > 0);
  });

  porPrioridad = computed<BarDatum[]>(() => {
    const colors: Record<string, string> = {
      urgente: 'var(--sgc-danger)', alta: 'var(--sgc-warning)', media: 'var(--sgc-primary)', baja: '#64748b',
    };
    return this.PRIORIDADES.map((p) => ({
      label: p.label,
      value: this.tareas().filter((t) => t.prioridad === p.value).length,
      color: colors[p.value],
    })).filter((d) => d.value > 0);
  });

  porResponsable = computed<BarDatum[]>(() => {
    const map = new Map<string, number>();
    for (const t of this.tareas()) {
      const n = t.asignado?.nombre ?? '—';
      map.set(n, (map.get(n) ?? 0) + 1);
    }
    return [...map.entries()]
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10);
  });

  completadas = computed(() => this.tareas().filter((t) => t.estado === 'completada').length);

  async ngOnInit() {
    this.loading.set(true);
    this.error.set('');
    try {
      // getAll() is RLS-scoped: managers get every task, others get their own.
      this.tareas.set(await this.tareasService.getAll());
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'Error al cargar el historial.');
    } finally {
      this.loading.set(false);
    }
  }

  onSearch(v: string) { this.searchQuery.set(v); }
  onEstado(v: string) { this.selectedEstado.set(v); }
  onPrioridad(v: string) { this.selectedPrioridad.set(v); }

  openDetail(t: Tarea) {
    this.detailTarea.set(t);
    this.detailOpen.set(true);
  }
  closeDetail() { this.detailOpen.set(false); }
  onUpdated(u: Tarea) {
    this.tareas.update((list) => list.map((t) => (t.id === u.id ? u : t)));
    this.detailTarea.set(u);
  }

  estadoBadgeClass(estado: TareaEstado): string {
    switch (estado) {
      case 'pendiente': return 'sgc-badge sgc-badge--neutral';
      case 'en_progreso': return 'sgc-badge sgc-badge--info';
      case 'completada': return 'sgc-badge sgc-badge--success';
      case 'cancelada': return 'sgc-badge sgc-badge--danger';
    }
  }
  estadoLabel(estado: TareaEstado): string {
    return this.ESTADOS.find((e) => e.value === estado)?.label ?? estado;
  }
  prioridadLabel(p: string): string {
    return this.PRIORIDADES.find((x) => x.value === p)?.label ?? p;
  }
}
