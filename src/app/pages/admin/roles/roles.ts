import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  computed,
  OnInit,
} from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { RolesService, Rol, MODULOS_DISPONIBLES } from '../../../../shared/services/roles.service';
import { FormDrawer } from '../../../../shared/components/form-drawer/form-drawer';

@Component({
  selector: 'app-admin-roles',
  imports: [ReactiveFormsModule, FormDrawer],
  templateUrl: './roles.html',
  styleUrl: './roles.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminRoles implements OnInit {
  private rolesService = inject(RolesService);

  // ── Data ─────────────────────────────────────────────────
  roles = signal<Rol[]>([]);
  loading = signal(true);
  saving = signal(false);
  error = signal('');
  saveError = signal('');

  // ── Drawer ───────────────────────────────────────────────
  drawerOpen = signal(false);
  editingRol = signal<Rol | null>(null);
  selectedModulos = signal<string[]>([]);

  readonly modulos = MODULOS_DISPONIBLES;

  form = new FormGroup({
    nombre: new FormControl('', [Validators.required, Validators.maxLength(100)]),
  });

  // ── Computed ─────────────────────────────────────────────
  drawerTitle = computed(() => {
    const r = this.editingRol();
    return r ? `Editar rol: ${r.nombre}` : 'Editar rol';
  });

  async ngOnInit() {
    await this.loadRoles();
  }

  private async loadRoles() {
    this.loading.set(true);
    this.error.set('');
    try {
      const data = await this.rolesService.getAll();
      this.roles.set(data);
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'Error al cargar roles.');
    } finally {
      this.loading.set(false);
    }
  }

  openEdit(rol: Rol) {
    this.editingRol.set(rol);
    this.saveError.set('');
    this.form.reset({ nombre: rol.nombre });
    this.selectedModulos.set([...(rol.modulos ?? [])]);
    this.drawerOpen.set(true);
  }

  closeDrawer() {
    this.drawerOpen.set(false);
  }

  isModuloSelected(key: string): boolean {
    return this.selectedModulos().includes(key);
  }

  toggleModulo(key: string) {
    this.selectedModulos.update((mods) =>
      mods.includes(key) ? mods.filter((m) => m !== key) : [...mods, key],
    );
  }

  getModuloLabel(key: string): string {
    return this.modulos.find((m) => m.key === key)?.label ?? key;
  }

  async onSave() {
    this.form.markAllAsTouched();
    if (this.form.invalid || this.saving()) return;

    const rol = this.editingRol();
    if (!rol) return;

    this.saving.set(true);
    this.saveError.set('');

    try {
      await this.rolesService.update(rol.id, {
        nombre: this.form.value.nombre!,
        modulos: this.selectedModulos(),
      });

      const updated = await this.rolesService.getAll();
      this.roles.set(updated);
      this.drawerOpen.set(false);
    } catch (e: unknown) {
      this.saveError.set(e instanceof Error ? e.message : 'Error al guardar.');
    } finally {
      this.saving.set(false);
    }
  }

  get f() {
    return this.form.controls;
  }
}
