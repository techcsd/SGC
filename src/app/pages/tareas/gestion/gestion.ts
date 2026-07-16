import { Component, ChangeDetectionStrategy, inject, signal, computed, OnInit, OnDestroy } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { RealtimeChannel } from '@supabase/supabase-js';
import { TareasService, DirectorioUsuario } from '../../../../shared/services/tareas.service';
import { ProyectosService } from '../../../../shared/services/proyectos.service';
import { UserService } from '../../../core/services/user.service';
import { NotificacionesService } from '../../../../shared/services/notificaciones.service';
import { Tarea, TareaEstado, TAREA_ESTADOS, TAREA_PRIORIDADES } from '../../../../shared/models/tarea.model';
import { Proyecto } from '../../../../shared/models/proyecto.model';
import { todayIso } from '../../../../shared/utils/fecha.util';
import { FormDrawer } from '../../../../shared/components/form-drawer/form-drawer';
import { TareaDetalle } from '../../../../shared/components/tarea-detalle/tarea-detalle';
import { Skeleton } from '../../../../shared/components/skeleton/skeleton';

@Component({
  selector: 'app-tareas-gestion',
  imports: [ReactiveFormsModule, FormDrawer, TareaDetalle, DatePipe, Skeleton],
  templateUrl: './gestion.html',
  styleUrl: './gestion.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Gestion implements OnInit, OnDestroy {
  private tareasService = inject(TareasService);
  private proyectosService = inject(ProyectosService);
  private userService = inject(UserService);
  private notificaciones = inject(NotificacionesService);
  private channel: RealtimeChannel | null = null;

  readonly ESTADOS = TAREA_ESTADOS;
  readonly PRIORIDADES = TAREA_PRIORIDADES;

  tareas = signal<Tarea[]>([]);
  usuarios = signal<DirectorioUsuario[]>([]);
  proyectos = signal<Proyecto[]>([]);
  loading = signal(true);
  saving = signal(false);
  error = signal('');
  saveError = signal('');

  searchQuery = signal('');
  selectedEstado = signal<string>('activas');
  selectedAsignado = signal<string>('all');

  drawerOpen = signal(false);
  detailOpen = signal(false);
  detailTarea = signal<Tarea | null>(null);

  form = new FormGroup({
    titulo: new FormControl('', [Validators.required, Validators.maxLength(200)]),
    descripcion: new FormControl<string | null>(null),
    prioridad: new FormControl<string>('media', [Validators.required]),
    asignado_a: new FormControl<string | null>(null, [Validators.required]),
    proyecto_id: new FormControl<string | null>(null),
    fecha_limite: new FormControl<string | null>(null),
  });

  filtered = computed(() => {
    const q = this.searchQuery().toLowerCase().trim();
    const estado = this.selectedEstado();
    const asignado = this.selectedAsignado();

    return this.tareas().filter((t) => {
      if (q && !t.titulo.toLowerCase().includes(q) && !(t.asignado?.nombre ?? '').toLowerCase().includes(q)) {
        return false;
      }
      if (estado === 'activas') {
        if (t.estado !== 'pendiente' && t.estado !== 'en_progreso') return false;
      } else if (estado !== 'all' && t.estado !== estado) {
        return false;
      }
      if (asignado !== 'all' && t.asignado_a !== asignado) return false;
      return true;
    });
  });

  async ngOnInit() {
    await this.loadAll();
    this.channel = this.tareasService.subscribeTareas(() => void this.reloadTareas());
  }

  ngOnDestroy() {
    if (this.channel) void this.tareasService.unsubscribe(this.channel);
  }

  private async reloadTareas() {
    try {
      this.tareas.set(await this.tareasService.getAll());
    } catch {
      // ignore transient realtime-triggered reload errors
    }
  }

  private async loadAll() {
    this.loading.set(true);
    this.error.set('');
    try {
      const [tareas, usuarios, proyectos] = await Promise.all([
        this.tareasService.getAll(),
        this.tareasService.getDirectorio(),
        this.proyectosService.getAll(),
      ]);
      this.tareas.set(tareas);
      this.usuarios.set(usuarios);
      this.proyectos.set(proyectos);
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'Error al cargar las tareas.');
    } finally {
      this.loading.set(false);
    }
  }

  onSearch(value: string) {
    this.searchQuery.set(value);
  }
  onEstadoChange(value: string) {
    this.selectedEstado.set(value);
  }
  onAsignadoChange(value: string) {
    this.selectedAsignado.set(value);
  }
  clearFilters() {
    this.searchQuery.set('');
    this.selectedEstado.set('activas');
    this.selectedAsignado.set('all');
  }

  openCreate() {
    this.saveError.set('');
    this.form.reset({ prioridad: 'media' });
    this.drawerOpen.set(true);
  }

  closeDrawer() {
    this.drawerOpen.set(false);
  }

  async onSave() {
    this.form.markAllAsTouched();
    if (this.form.invalid || this.saving()) return;

    const userId = this.userService.profile()?.id;
    if (!userId) {
      this.saveError.set('No se pudo identificar el usuario.');
      return;
    }

    this.saving.set(true);
    this.saveError.set('');

    const raw = this.form.value;
    try {
      const created = await this.tareasService.create({
        titulo: raw.titulo!,
        descripcion: raw.descripcion || null,
        prioridad: raw.prioridad!,
        asignadoA: raw.asignado_a!,
        asignadoPor: userId,
        proyectoId: raw.proyecto_id || null,
        fechaLimite: raw.fecha_limite || null,
      });
      this.tareas.update((list) => [created, ...list]);
      this.drawerOpen.set(false);
      this.notificaciones.refresh();
    } catch (e: unknown) {
      this.saveError.set(e instanceof Error ? e.message : 'Error al crear la tarea.');
    } finally {
      this.saving.set(false);
    }
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

  onDeleted(id: string) {
    this.tareas.update((list) => list.filter((t) => t.id !== id));
    this.detailOpen.set(false);
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
    return this.PRIORIDADES.find((p) => p.value === prioridad)?.label ?? prioridad;
  }

  isVencida(t: Tarea): boolean {
    if (!t.fecha_limite || t.estado === 'completada' || t.estado === 'cancelada') return false;
    return t.fecha_limite < todayIso();
  }

  get f() {
    return this.form.controls;
  }
}
