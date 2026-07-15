import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  computed,
  OnInit,
} from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { toSignal } from '@angular/core/rxjs-interop';
import { CategoriasService } from '../../../../shared/services/categorias.service';
import { ToastService } from '../../../../shared/services/toast.service';
import { Categoria, CategoriaFormData } from '../../../../shared/models/categoria.model';
import { FormDrawer } from '../../../../shared/components/form-drawer/form-drawer';
import { Skeleton } from '../../../../shared/components/skeleton/skeleton';
import { homologarTexto } from '../../../../shared/utils/texto.util';

@Component({
  selector: 'app-inventario-categorias',
  imports: [ReactiveFormsModule, FormDrawer, Skeleton],
  templateUrl: './categorias.html',
  styleUrl: './categorias.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InventarioCategorias implements OnInit {
  private categoriasService = inject(CategoriasService);
  private toast = inject(ToastService);

  // ── Data state ──────────────────────────────────────────
  categorias = signal<Categoria[]>([]);
  loading = signal(true);
  saving = signal(false);
  error = signal('');
  saveError = signal('');

  // ── Drawer ───────────────────────────────────────────────
  drawerOpen = signal(false);
  editingId = signal<number | null>(null);

  form = new FormGroup({
    nombre: new FormControl('', [Validators.required, Validators.maxLength(120)]),
    orden: new FormControl<number>(100, [Validators.required]),
    destacada: new FormControl<boolean>(false),
    activo: new FormControl<boolean>(true),
  });

  // ── Computed ─────────────────────────────────────────────
  drawerTitle = computed(() => (this.editingId() ? 'Editar categoría' : 'Nueva categoría'));

  // R18 — vista previa de homologación del nombre (FormControl.value no es reactivo).
  private nombreValue = toSignal(this.form.controls.nombre.valueChanges, { initialValue: '' });
  nombreHint = computed(() => {
    const raw = (this.nombreValue() ?? '').trim();
    const homologado = homologarTexto(raw);
    return homologado && homologado !== raw ? homologado : '';
  });

  async ngOnInit() {
    await this.loadAll();
  }

  private async loadAll() {
    this.loading.set(true);
    this.error.set('');
    try {
      const data = await this.categoriasService.getAllAdmin();
      this.categorias.set(data);
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'Error al cargar las categorías.');
    } finally {
      this.loading.set(false);
    }
  }

  // ── Drawer ───────────────────────────────────────────────
  openCreate() {
    this.editingId.set(null);
    this.saveError.set('');
    this.form.reset({ nombre: '', orden: 100, destacada: false, activo: true });
    this.drawerOpen.set(true);
  }

  openEdit(categoria: Categoria) {
    this.editingId.set(categoria.id);
    this.saveError.set('');
    this.form.reset({
      nombre: categoria.nombre,
      orden: categoria.orden,
      destacada: categoria.destacada,
      activo: categoria.activo,
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

    const v = this.form.value;

    try {
      const id = this.editingId();
      if (id) {
        // update recibe Partial: no tocamos descripcion/padre_id existentes.
        const updated = await this.categoriasService.update(id, {
          nombre: v.nombre!,
          orden: Number(v.orden ?? 100),
          destacada: !!v.destacada,
          activo: !!v.activo,
        });
        this.categorias.update((list) => list.map((c) => (c.id === id ? updated : c)));
        this.toast.success('Categoría actualizada', updated.nombre);
      } else {
        const payload: CategoriaFormData = {
          nombre: v.nombre!,
          descripcion: null,
          orden: Number(v.orden ?? 100),
          destacada: !!v.destacada,
          activo: !!v.activo,
        };
        const created = await this.categoriasService.create(payload);
        this.categorias.update((list) => [created, ...list]);
        this.toast.success('Categoría creada', created.nombre);
      }
      // Reload para reflejar el orden real (destacadas primero + orden) del servidor.
      await this.loadAll();
      this.drawerOpen.set(false);
    } catch (e: unknown) {
      this.saveError.set(e instanceof Error ? e.message : 'Error al guardar.');
    } finally {
      this.saving.set(false);
    }
  }

  // ── Actions ──────────────────────────────────────────────
  async toggleActivo(categoria: Categoria) {
    const next = !categoria.activo;
    this.categorias.update((list) =>
      list.map((c) => (c.id === categoria.id ? { ...c, activo: next } : c)),
    );
    try {
      await this.categoriasService.toggleActivo(categoria.id, next);
    } catch {
      // revert on error
      this.categorias.update((list) =>
        list.map((c) => (c.id === categoria.id ? { ...c, activo: !next } : c)),
      );
      this.toast.error('No se pudo cambiar el estado de la categoría.');
    }
  }

  get f() {
    return this.form.controls;
  }
}
