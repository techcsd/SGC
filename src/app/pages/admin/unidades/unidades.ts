import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { UnidadesService } from '../../../../shared/services/unidades.service';
import { Unidad } from '../../../../shared/models/unidad.model';

/** Admin management of the unidades de medida used by the artículo form. */
@Component({
  selector: 'app-admin-unidades',
  imports: [FormsModule],
  templateUrl: './unidades.html',
  styleUrl: './unidades.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminUnidades implements OnInit {
  private service = inject(UnidadesService);

  unidades = signal<Unidad[]>([]);
  loading = signal(true);
  error = signal('');
  saving = signal(false);

  nuevoNombre = signal('');
  editingId = signal<number | null>(null);
  editNombre = signal('');

  async ngOnInit() {
    await this.load();
  }

  private async load() {
    this.loading.set(true);
    this.error.set('');
    try {
      this.unidades.set(await this.service.getAll());
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'Error al cargar las unidades.');
    } finally {
      this.loading.set(false);
    }
  }

  async agregar() {
    const nombre = this.nuevoNombre().trim();
    if (!nombre || this.saving()) return;
    const codigo = UnidadesService.slug(nombre);
    if (!codigo) {
      this.error.set('Nombre inválido.');
      return;
    }
    this.saving.set(true);
    this.error.set('');
    try {
      const u = await this.service.create({ codigo, nombre });
      this.unidades.update((list) => [...list, u].sort((a, b) => a.nombre.localeCompare(b.nombre)));
      this.nuevoNombre.set('');
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'Error al agregar.');
    } finally {
      this.saving.set(false);
    }
  }

  startEdit(u: Unidad) {
    this.editingId.set(u.id);
    this.editNombre.set(u.nombre);
  }

  cancelEdit() {
    this.editingId.set(null);
  }

  async guardarNombre(u: Unidad) {
    const nombre = this.editNombre().trim();
    if (!nombre) return;
    try {
      await this.service.updateNombre(u.id, nombre);
      this.unidades.update((list) => list.map((x) => (x.id === u.id ? { ...x, nombre } : x)));
      this.editingId.set(null);
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'Error al guardar.');
    }
  }

  async toggle(u: Unidad) {
    const next = !u.activo;
    this.unidades.update((list) => list.map((x) => (x.id === u.id ? { ...x, activo: next } : x)));
    try {
      await this.service.toggleActivo(u.id, next);
    } catch {
      this.unidades.update((list) => list.map((x) => (x.id === u.id ? { ...x, activo: !next } : x)));
    }
  }
}
