import {
  Component,
  ChangeDetectionStrategy,
  inject,
  input,
  signal,
  computed,
  effect,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DecimalPipe } from '@angular/common';
import { ProyectosService } from '../../services/proyectos.service';
import { ToastService } from '../../services/toast.service';
import { ProyectoPartida } from '../../models/proyecto-partida.model';

/**
 * R24 — Partidas de obra + avance físico, embebido en el detalle del proyecto.
 * Avance físico = round(100 * Σ min(ejecutada, planeada) / Σ planeada).
 */
@Component({
  selector: 'app-proyecto-partidas',
  imports: [FormsModule, DecimalPipe],
  templateUrl: './proyecto-partidas.html',
  styleUrl: './proyecto-partidas.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProyectoPartidas {
  proyectoId = input.required<string>();

  private service = inject(ProyectosService);
  private toast = inject(ToastService);

  // ── Data ───────────────────────────────────────────────────
  partidas = signal<ProyectoPartida[]>([]);
  loading = signal(true);
  error = signal('');

  // ── Derived ────────────────────────────────────────────────
  private sumPlaneada = computed(() =>
    this.partidas().reduce((s, p) => s + (p.cantidad_planeada || 0), 0),
  );
  private sumEjecutada = computed(() =>
    this.partidas().reduce((s, p) => s + Math.min(p.cantidad_ejecutada || 0, p.cantidad_planeada || 0), 0),
  );
  /** Avance físico global (%) o null si no hay partidas con planeada > 0. */
  avanceFisico = computed<number | null>(() => {
    const plan = this.sumPlaneada();
    if (this.partidas().length === 0 || plan <= 0) return null;
    return Math.round((100 * this.sumEjecutada()) / plan);
  });

  // ── Inline form ────────────────────────────────────────────
  showForm = signal(false);
  editingId = signal<string | null>(null);
  saving = signal(false);
  formError = signal('');

  fNombre = signal('');
  fUnidad = signal('');
  fPlaneada = signal<number>(0);
  fEjecutada = signal<number>(0);
  fOrden = signal<number>(1);

  formTitle = computed(() => (this.editingId() ? 'Editar partida' : 'Nueva partida'));

  constructor() {
    effect(() => {
      const id = this.proyectoId();
      if (id) this.load(id);
    });
  }

  private async load(id: string) {
    this.loading.set(true);
    this.error.set('');
    try {
      this.partidas.set(await this.service.getPartidas(id));
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'Error al cargar las partidas.');
    } finally {
      this.loading.set(false);
    }
  }

  /** Progreso individual de una partida (0-100). */
  partidaPct(p: ProyectoPartida): number {
    const plan = p.cantidad_planeada || 0;
    if (plan <= 0) return 0;
    return Math.round((100 * Math.min(p.cantidad_ejecutada || 0, plan)) / plan);
  }

  // ── Form ───────────────────────────────────────────────────
  openNew() {
    this.editingId.set(null);
    this.formError.set('');
    this.fNombre.set('');
    this.fUnidad.set('');
    this.fPlaneada.set(0);
    this.fEjecutada.set(0);
    this.fOrden.set(this.partidas().length + 1);
    this.showForm.set(true);
  }

  openEdit(p: ProyectoPartida) {
    this.editingId.set(p.id);
    this.formError.set('');
    this.fNombre.set(p.nombre);
    this.fUnidad.set(p.unidad ?? '');
    this.fPlaneada.set(p.cantidad_planeada);
    this.fEjecutada.set(p.cantidad_ejecutada);
    this.fOrden.set(p.orden);
    this.showForm.set(true);
  }

  cancelForm() {
    this.showForm.set(false);
    this.editingId.set(null);
  }

  async save() {
    if (this.saving()) return;
    const nombre = this.fNombre().trim();
    if (!nombre) {
      this.formError.set('El nombre es obligatorio.');
      return;
    }
    const planeada = this.fPlaneada();
    const ejecutada = this.fEjecutada();
    if (planeada < 0 || ejecutada < 0) {
      this.formError.set('Las cantidades no pueden ser negativas.');
      return;
    }

    this.saving.set(true);
    this.formError.set('');
    const payload = {
      nombre,
      unidad: this.fUnidad().trim() || null,
      cantidad_planeada: planeada,
      cantidad_ejecutada: ejecutada,
      orden: this.fOrden() || 0,
    };

    try {
      const editId = this.editingId();
      if (editId) {
        await this.service.actualizarPartida(editId, payload);
        this.toast.success('Partida actualizada', nombre);
      } else {
        await this.service.crearPartida(this.proyectoId(), payload);
        this.toast.success('Partida creada', nombre);
      }
      await this.load(this.proyectoId());
      this.showForm.set(false);
      this.editingId.set(null);
    } catch (e: unknown) {
      this.formError.set(e instanceof Error ? e.message : 'Error al guardar la partida.');
    } finally {
      this.saving.set(false);
    }
  }

  async remove(p: ProyectoPartida) {
    if (!confirm(`¿Eliminar la partida "${p.nombre}"?`)) return;
    const previo = this.partidas();
    this.partidas.update((list) => list.filter((x) => x.id !== p.id));
    try {
      await this.service.eliminarPartida(p.id);
      this.toast.success('Partida eliminada', p.nombre);
    } catch (e: unknown) {
      this.partidas.set(previo);
      this.toast.error('No se pudo eliminar la partida', e instanceof Error ? e.message : undefined);
    }
  }
}
