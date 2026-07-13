import { Component, ChangeDetectionStrategy, inject, signal, computed, OnInit } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { TecnologiaService } from '../../../../shared/services/tecnologia.service';
import { ToastService } from '../../../../shared/services/toast.service';
import {
  TecHerramienta,
  TecHerramientaFormData,
  TEC_CATEGORIAS,
} from '../../../../shared/models/tecnologia.model';
import { FormDrawer } from '../../../../shared/components/form-drawer/form-drawer';
import { Skeleton } from '../../../../shared/components/skeleton/skeleton';

@Component({
  selector: 'app-tec-homologacion',
  imports: [ReactiveFormsModule, FormDrawer, Skeleton],
  templateUrl: './homologacion.html',
  styleUrl: './homologacion.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TecHomologacion implements OnInit {
  private tecnologia = inject(TecnologiaService);
  private toast = inject(ToastService);

  readonly CATEGORIAS = TEC_CATEGORIAS;

  herramientas = signal<TecHerramienta[]>([]);
  loading = signal(true);
  saving = signal(false);
  error = signal('');
  saveError = signal('');

  drawerOpen = signal(false);
  editingId = signal<string | null>(null);

  form = new FormGroup({
    nombre: new FormControl('', [Validators.required, Validators.maxLength(200)]),
    categoria: new FormControl<string | null>(null, [Validators.required]),
    para_que: new FormControl<string | null>(null),
    quien_usa: new FormControl<string | null>(null),
    url: new FormControl<string | null>(null),
    activo: new FormControl<boolean>(true),
  });

  drawerTitle = computed(() => (this.editingId() ? 'Editar herramienta' : 'Nueva herramienta'));

  async ngOnInit() {
    await this.loadAll();
  }

  private async loadAll() {
    this.loading.set(true);
    this.error.set('');
    try {
      const herramientas = await this.tecnologia.getHerramientas(false);
      this.herramientas.set(herramientas);
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'Error al cargar las herramientas.');
    } finally {
      this.loading.set(false);
    }
  }

  getCategoriaLabel(value: string): string {
    return this.CATEGORIAS.find((c) => c.value === value)?.label ?? value;
  }

  // ── Drawer ────────────────────────────────────────────────
  openCreate() {
    this.editingId.set(null);
    this.saveError.set('');
    this.form.reset({ activo: true, categoria: null, para_que: null, quien_usa: null, url: null });
    this.drawerOpen.set(true);
  }

  openEdit(h: TecHerramienta) {
    this.editingId.set(h.id);
    this.saveError.set('');
    this.form.reset({
      nombre: h.nombre,
      categoria: h.categoria,
      para_que: h.para_que,
      quien_usa: h.quien_usa,
      url: h.url,
      activo: h.activo,
    });
    this.drawerOpen.set(true);
  }

  closeDrawer() {
    this.drawerOpen.set(false);
  }

  async onSave() {
    this.form.markAllAsTouched();
    if (this.form.invalid || this.saving()) return;

    this.saving.set(true);
    this.saveError.set('');

    const payload = this.form.value as TecHerramientaFormData;

    try {
      const id = this.editingId();
      if (id) {
        await this.tecnologia.updateHerramienta(id, payload);
        this.herramientas.update((list) =>
          list.map((h) => (h.id === id ? { ...h, ...payload } : h)),
        );
        this.toast.success('Herramienta actualizada');
      } else {
        const created = await this.tecnologia.createHerramienta(payload);
        this.herramientas.update((list) => [...list, created]);
        this.toast.success('Herramienta creada');
      }
      this.drawerOpen.set(false);
    } catch (e: unknown) {
      this.saveError.set(e instanceof Error ? e.message : 'Error al guardar.');
    } finally {
      this.saving.set(false);
    }
  }

  async toggleActivo(h: TecHerramienta) {
    const next = !h.activo;
    this.herramientas.update((list) =>
      list.map((x) => (x.id === h.id ? { ...x, activo: next } : x)),
    );
    try {
      await this.tecnologia.updateHerramienta(h.id, { activo: next });
    } catch {
      this.herramientas.update((list) =>
        list.map((x) => (x.id === h.id ? { ...x, activo: !next } : x)),
      );
      this.toast.error('No se pudo cambiar el estado de la herramienta.');
    }
  }

  async remove(h: TecHerramienta) {
    if (!confirm(`¿Eliminar la herramienta "${h.nombre}"? Esta acción no se puede deshacer.`)) return;
    try {
      await this.tecnologia.removeHerramienta(h.id);
      this.herramientas.update((list) => list.filter((x) => x.id !== h.id));
      this.toast.success('Herramienta eliminada');
    } catch (e: unknown) {
      this.toast.error(e instanceof Error ? e.message : 'Error al eliminar.');
    }
  }

  get f() {
    return this.form.controls;
  }
}
