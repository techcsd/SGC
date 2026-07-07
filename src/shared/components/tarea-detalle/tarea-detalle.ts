import { Component, ChangeDetectionStrategy, inject, input, output, signal, effect } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { TareasService } from '../../services/tareas.service';
import { UserService } from '../../../app/core/services/user.service';
import { Tarea, TareaComentario, TareaEstado, TAREA_ESTADOS, TAREA_PRIORIDADES } from '../../models/tarea.model';
import { FormDrawer } from '../form-drawer/form-drawer';

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
  imports: [ReactiveFormsModule, FormDrawer, DatePipe],
  templateUrl: './tarea-detalle.html',
  styleUrl: './tarea-detalle.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TareaDetalle {
  private tareasService = inject(TareasService);
  private userService = inject(UserService);

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

  constructor() {
    // Load the comment thread whenever a task is opened.
    effect(() => {
      const t = this.tarea();
      const isOpen = this.open();
      if (isOpen && t) {
        void this.loadComentarios(t.id);
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

  close() {
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
    // Both are YYYY-MM-DD; lexicographic compare is correct and avoids the
    // new Date() date-shift trap.
    return t.fecha_limite < new Date().toISOString().slice(0, 10);
  }
}
