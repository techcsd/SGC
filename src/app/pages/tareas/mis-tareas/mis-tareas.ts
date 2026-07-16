import { Component, ChangeDetectionStrategy, inject, signal, computed, OnInit, OnDestroy } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RealtimeChannel } from '@supabase/supabase-js';
import { TareasService } from '../../../../shared/services/tareas.service';
import { UserService } from '../../../core/services/user.service';
import { NotificacionesService } from '../../../../shared/services/notificaciones.service';
import { Tarea, TareaEstado, TAREA_ESTADOS } from '../../../../shared/models/tarea.model';
import { todayIso } from '../../../../shared/utils/fecha.util';
import { TareaDetalle } from '../../../../shared/components/tarea-detalle/tarea-detalle';
import { Skeleton } from '../../../../shared/components/skeleton/skeleton';

@Component({
  selector: 'app-mis-tareas',
  imports: [DatePipe, TareaDetalle, Skeleton],
  templateUrl: './mis-tareas.html',
  styleUrl: './mis-tareas.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MisTareas implements OnInit, OnDestroy {
  private tareasService = inject(TareasService);
  private userService = inject(UserService);
  private notificaciones = inject(NotificacionesService);
  private channel: RealtimeChannel | null = null;

  readonly ESTADOS = TAREA_ESTADOS;

  tareas = signal<Tarea[]>([]);
  loading = signal(true);
  error = signal('');
  selectedEstado = signal<string>('activas');

  detailOpen = signal(false);
  detailTarea = signal<Tarea | null>(null);

  filtered = computed(() => {
    const estado = this.selectedEstado();
    return this.tareas().filter((t) => {
      if (estado === 'activas') return t.estado === 'pendiente' || t.estado === 'en_progreso';
      if (estado === 'all') return true;
      return t.estado === estado;
    });
  });

  countActivas = computed(
    () => this.tareas().filter((t) => t.estado === 'pendiente' || t.estado === 'en_progreso').length,
  );

  async ngOnInit() {
    await this.load();
    // Live-refresh when any of my tasks changes state elsewhere (no manual reload).
    this.channel = this.tareasService.subscribeTareas(() => void this.load());
  }

  ngOnDestroy() {
    if (this.channel) void this.tareasService.unsubscribe(this.channel);
  }

  private async load() {
    this.loading.set(true);
    this.error.set('');
    const userId = this.userService.profile()?.id;
    if (!userId) {
      this.error.set('No se pudo identificar el usuario.');
      this.loading.set(false);
      return;
    }
    try {
      this.tareas.set(await this.tareasService.getAsignadasA(userId));
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'Error al cargar tus tareas.');
    } finally {
      this.loading.set(false);
    }
  }

  onEstadoChange(value: string) {
    this.selectedEstado.set(value);
  }

  openDetail(t: Tarea) {
    this.detailTarea.set(t);
    this.detailOpen.set(true);
  }

  closeDetail() {
    this.detailOpen.set(false);
  }

  onUpdated(updated: Tarea) {
    this.tareas.update((list) => list.map((t) => (t.id === updated.id ? updated : t)));
    this.detailTarea.set(updated);
    this.notificaciones.refresh();
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

  prioridadBadgeClass(prioridad: string): string {
    switch (prioridad) {
      case 'urgente': return 'sgc-badge sgc-badge--danger';
      case 'alta': return 'sgc-badge sgc-badge--warning';
      case 'baja': return 'sgc-badge sgc-badge--neutral';
      default: return 'sgc-badge sgc-badge--info';
    }
  }

  prioridadLabel(prioridad: string): string {
    switch (prioridad) {
      case 'urgente': return 'Urgente';
      case 'alta': return 'Alta';
      case 'media': return 'Media';
      case 'baja': return 'Baja';
      default: return prioridad;
    }
  }

  isVencida(t: Tarea): boolean {
    if (!t.fecha_limite || t.estado === 'completada' || t.estado === 'cancelada') return false;
    return t.fecha_limite < todayIso();
  }
}
