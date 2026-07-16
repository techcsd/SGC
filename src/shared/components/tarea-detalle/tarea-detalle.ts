import { Component, ChangeDetectionStrategy, inject, input, output, signal, effect } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { RealtimeChannel } from '@supabase/supabase-js';
import { TareasService, DirectorioUsuario } from '../../services/tareas.service';
import { UserService } from '../../../app/core/services/user.service';
import { ToastService } from '../../services/toast.service';
import { Tarea, TareaComentario, TareaEstado, TAREA_ESTADOS, TAREA_PRIORIDADES } from '../../models/tarea.model';
import { todayIso } from '../../utils/fecha.util';
import { FormDrawer } from '../form-drawer/form-drawer';
import { WeatherCard } from '../../context/weather-card/weather-card';

// Allowed forward transitions. Assignees drive pendiente→en_progreso→completada;
// cancelada is a manager-only escape hatch handled separately in the template.
const ESTADO_TRANSICIONES: Record<TareaEstado, TareaEstado[]> = {
  pendiente: ['en_progreso', 'completada'],
  en_progreso: ['completada', 'pendiente'],
  completada: ['en_progreso'],
  cancelada: ['pendiente'],
};

@Component({
  selector: 'app-tarea-detalle',
  imports: [ReactiveFormsModule, FormDrawer, DatePipe, WeatherCard],
  templateUrl: './tarea-detalle.html',
  styleUrl: './tarea-detalle.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TareaDetalle {
  private tareasService = inject(TareasService);
  private userService = inject(UserService);
  private toast = inject(ToastService);

  tarea = input<Tarea | null>(null);
  open = input<boolean>(false);
  canManage = input<boolean>(false);

  closed = output<void>();
  updated = output<Tarea>();
  deleted = output<string>();

  readonly ESTADOS = TAREA_ESTADOS;
  readonly PRIORIDADES = TAREA_PRIORIDADES;

  comentarios = signal<TareaComentario[]>([]);
  loadingComentarios = signal(false);
  nuevoComentario = new FormControl('');
  savingComentario = signal(false);
  working = signal(false);

  // ── QA-073 — Edición / reasignación (solo gestores) ──────
  usuarios = signal<DirectorioUsuario[]>([]);
  editMode = signal(false);
  savingEdit = signal(false);
  editError = signal('');
  editForm = new FormGroup({
    titulo: new FormControl('', [Validators.required, Validators.maxLength(200)]),
    descripcion: new FormControl<string | null>(null),
    prioridad: new FormControl<string>('media', [Validators.required]),
    asignado_a: new FormControl<string | null>(null, [Validators.required]),
    fecha_limite: new FormControl<string | null>(null),
  });

  private comentariosChannel: RealtimeChannel | null = null;
  private directorioLoaded = false;

  constructor() {
    // Load the comment thread whenever a task is opened, and keep it live via realtime.
    effect((onCleanup) => {
      const t = this.tarea();
      const isOpen = this.open();
      if (isOpen && t) {
        // QA-073 — al reabrir el detalle, cierra cualquier edición previa y, para
        // gestores, carga el directorio de responsables una sola vez.
        this.editMode.set(false);
        if (this.canManage() && !this.directorioLoaded) {
          this.directorioLoaded = true;
          void this.loadDirectorio();
        }
        void this.loadComentarios(t.id);
        // QA-055 — nuevos comentarios (de cualquiera) llegan sin recargar la página.
        this.comentariosChannel = this.tareasService.subscribeComentarios(t.id, () =>
          void this.reloadComentarios(t.id),
        );
        onCleanup(() => {
          if (this.comentariosChannel) {
            void this.tareasService.unsubscribe(this.comentariosChannel);
            this.comentariosChannel = null;
          }
        });
      }
    });
  }

  private async loadComentarios(tareaId: string) {
    this.loadingComentarios.set(true);
    this.nuevoComentario.reset('');
    try {
      this.comentarios.set(await this.tareasService.getComentarios(tareaId));
    } finally {
      this.loadingComentarios.set(false);
    }
  }

  /** Silent refresh (no spinner) triggered by realtime comment inserts. */
  private async reloadComentarios(tareaId: string) {
    try {
      this.comentarios.set(await this.tareasService.getComentarios(tareaId));
    } catch {
      /* ignore transient realtime-triggered reload errors */
    }
  }

  private async loadDirectorio() {
    try {
      this.usuarios.set(await this.tareasService.getDirectorio());
    } catch {
      // permite reintentar la próxima vez que se abra el detalle
      this.directorioLoaded = false;
    }
  }

  // ── QA-073 — Editar / reasignar tarea ────────────────────
  openEdit() {
    const t = this.tarea();
    if (!t || !this.canManage()) return;
    this.editError.set('');
    this.editForm.reset({
      titulo: t.titulo,
      descripcion: t.descripcion,
      prioridad: t.prioridad,
      asignado_a: t.asignado_a,
      fecha_limite: t.fecha_limite,
    });
    this.editMode.set(true);
  }

  cancelEdit() {
    this.editMode.set(false);
  }

  async guardarEdicion() {
    const t = this.tarea();
    this.editForm.markAllAsTouched();
    if (!t || this.editForm.invalid || this.savingEdit()) return;

    this.savingEdit.set(true);
    this.editError.set('');
    const raw = this.editForm.value;
    try {
      const updated = await this.tareasService.update(t.id, {
        titulo: raw.titulo!,
        descripcion: raw.descripcion || null,
        prioridad: (raw.prioridad ?? 'media') as Tarea['prioridad'],
        asignado_a: raw.asignado_a!,
        fecha_limite: raw.fecha_limite || null,
      });
      this.updated.emit(updated);
      this.editMode.set(false);
      this.toast.success('Tarea actualizada');
    } catch (e: unknown) {
      this.editError.set(e instanceof Error ? e.message : 'Error al guardar los cambios.');
    } finally {
      this.savingEdit.set(false);
    }
  }

  close() {
    this.editMode.set(false);
    this.closed.emit();
  }

  nextEstados(current: TareaEstado): TareaEstado[] {
    return ESTADO_TRANSICIONES[current];
  }

  async cambiarEstado(estado: TareaEstado) {
    const t = this.tarea();
    if (!t || this.working()) return;
    this.working.set(true);
    try {
      const updated = await this.tareasService.cambiarEstado(t.id, estado);
      this.updated.emit(updated);
    } finally {
      this.working.set(false);
    }
  }

  async eliminar() {
    const t = this.tarea();
    if (!t || this.working()) return;
    this.working.set(true);
    try {
      await this.tareasService.remove(t.id);
      this.deleted.emit(t.id);
    } finally {
      this.working.set(false);
    }
  }

  async onAddComentario() {
    const t = this.tarea();
    const texto = this.nuevoComentario.value?.trim();
    const userId = this.userService.profile()?.id;
    if (!t || !texto || !userId || this.savingComentario()) return;

    this.savingComentario.set(true);
    try {
      const c = await this.tareasService.addComentario(t.id, userId, texto);
      this.comentarios.update((list) => [...list, c]);
      this.nuevoComentario.reset('');
    } finally {
      this.savingComentario.set(false);
    }
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
    // Both are YYYY-MM-DD; lexicographic compare vs the local date avoids the
    // new Date()/UTC date-shift trap (would mark "vencida" ~4h early in RD).
    return t.fecha_limite < todayIso();
  }

  get ef() {
    return this.editForm.controls;
  }
}
