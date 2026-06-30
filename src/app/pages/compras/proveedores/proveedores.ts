import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  computed,
  OnInit,
} from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { TitleCasePipe } from '@angular/common';
import { ProveedoresService, ProveedorPayload } from '../../../../shared/services/proveedores.service';
import { Proveedor, PROVEEDOR_CATEGORIAS } from '../../../../shared/models/proveedor.model';
import { FormDrawer } from '../../../../shared/components/form-drawer/form-drawer';

@Component({
  selector: 'app-proveedores',
  imports: [ReactiveFormsModule, FormDrawer, TitleCasePipe],
  templateUrl: './proveedores.html',
  styleUrl: './proveedores.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Proveedores implements OnInit {
  private proveedoresService = inject(ProveedoresService);

  // ── Data state ──────────────────────────────────────────
  proveedores = signal<Proveedor[]>([]);
  loading = signal(true);
  saving = signal(false);
  error = signal('');
  saveError = signal('');

  // ── Filters ──────────────────────────────────────────────
  searchQuery = signal('');
  selectedCategoria = signal('');
  selectedActivo = signal<'all' | 'active' | 'inactive'>('all');

  // ── Drawer ───────────────────────────────────────────────
  drawerOpen = signal(false);
  editingId = signal<string | null>(null);

  readonly CATEGORIAS = PROVEEDOR_CATEGORIAS;

  form = new FormGroup({
    nombre: new FormControl('', [Validators.required, Validators.maxLength(200)]),
    ruc: new FormControl<string | null>(null),
    telefono: new FormControl<string | null>(null),
    email: new FormControl<string | null>(null, [Validators.email]),
    direccion: new FormControl<string | null>(null),
    categoria: new FormControl<string | null>(null),
    contacto_nombre: new FormControl<string | null>(null),
    notas: new FormControl<string | null>(null),
    activo: new FormControl<boolean>(true),
  });

  // ── Computed ─────────────────────────────────────────────
  filtered = computed(() => {
    const q = this.searchQuery().toLowerCase().trim();
    const cat = this.selectedCategoria();
    const activo = this.selectedActivo();

    return this.proveedores().filter((p) => {
      if (
        q &&
        !p.nombre.toLowerCase().includes(q) &&
        !(p.ruc ?? '').toLowerCase().includes(q) &&
        !(p.email ?? '').toLowerCase().includes(q)
      ) {
        return false;
      }
      if (cat && p.categoria !== cat) return false;
      if (activo === 'active' && !p.activo) return false;
      if (activo === 'inactive' && p.activo) return false;
      return true;
    });
  });

  drawerTitle = computed(() =>
    this.editingId() ? 'Editar proveedor' : 'Nuevo proveedor',
  );

  async ngOnInit() {
    await this.loadAll();
  }

  private async loadAll() {
    this.loading.set(true);
    this.error.set('');
    try {
      const data = await this.proveedoresService.getAll();
      this.proveedores.set(data);
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'Error al cargar los proveedores.');
    } finally {
      this.loading.set(false);
    }
  }

  // ── Filters ──────────────────────────────────────────────
  onSearch(value: string) {
    this.searchQuery.set(value);
  }

  onCategoriaChange(value: string) {
    this.selectedCategoria.set(value);
  }

  onActivoChange(value: string) {
    this.selectedActivo.set(value as 'all' | 'active' | 'inactive');
  }

  clearFilters() {
    this.searchQuery.set('');
    this.selectedCategoria.set('');
    this.selectedActivo.set('all');
  }

  // ── Drawer ───────────────────────────────────────────────
  openCreate() {
    this.editingId.set(null);
    this.saveError.set('');
    this.form.reset({ activo: true });
    this.drawerOpen.set(true);
  }

  openEdit(p: Proveedor) {
    this.editingId.set(p.id);
    this.saveError.set('');
    this.form.reset({
      nombre: p.nombre,
      ruc: p.ruc,
      telefono: p.telefono,
      email: p.email,
      direccion: p.direccion,
      categoria: p.categoria,
      contacto_nombre: p.contacto_nombre,
      notas: p.notas,
      activo: p.activo,
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

    const payload = this.form.value as ProveedorPayload;

    try {
      const id = this.editingId();
      if (id) {
        const updated = await this.proveedoresService.update(id, payload);
        this.proveedores.update((list) => list.map((p) => (p.id === id ? updated : p)));
      } else {
        const created = await this.proveedoresService.create(payload);
        this.proveedores.update((list) => [created, ...list]);
      }
      this.drawerOpen.set(false);
    } catch (e: unknown) {
      this.saveError.set(e instanceof Error ? e.message : 'Error al guardar.');
    } finally {
      this.saving.set(false);
    }
  }

  // ── Actions ──────────────────────────────────────────────
  async toggleActivo(p: Proveedor) {
    const next = !p.activo;
    this.proveedores.update((list) =>
      list.map((item) => (item.id === p.id ? { ...item, activo: next } : item)),
    );
    try {
      await this.proveedoresService.toggleActivo(p.id, next);
    } catch {
      this.proveedores.update((list) =>
        list.map((item) => (item.id === p.id ? { ...item, activo: !next } : item)),
      );
    }
  }

  get f() {
    return this.form.controls;
  }
}
