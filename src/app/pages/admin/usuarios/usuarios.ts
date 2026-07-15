import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  computed,
  OnInit,
} from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { AdminService, UsuarioAdmin } from '../../../../shared/services/admin.service';
import { UserService } from '../../../core/services/user.service';
import { Rol } from '../../../../shared/models/usuario.model';
import { FormDrawer } from '../../../../shared/components/form-drawer/form-drawer';
import { formatFechaMedia } from '../../../../shared/utils/fecha.util';

@Component({
  selector: 'app-admin-usuarios',
  imports: [ReactiveFormsModule, FormDrawer],
  templateUrl: './usuarios.html',
  styleUrl: './usuarios.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminUsuarios implements OnInit {
  private adminService = inject(AdminService);
  private userService = inject(UserService);

  formatFecha = formatFechaMedia; // U9

  // ── Data ─────────────────────────────────────────────────
  usuarios = signal<UsuarioAdmin[]>([]);
  roles = signal<Rol[]>([]);
  loading = signal(true);
  saving = signal(false);
  error = signal('');
  saveError = signal('');

  // ── Filters ──────────────────────────────────────────────
  searchQuery = signal('');
  selectedStatus = signal<'all' | 'active' | 'inactive'>('all');

  // ── Drawer ───────────────────────────────────────────────
  drawerOpen = signal(false);
  editingUser = signal<UsuarioAdmin | null>(null);
  selectedRolIds = signal<number[]>([]);

  form = new FormGroup({
    nombre: new FormControl('', [Validators.required, Validators.maxLength(150)]),
    activo: new FormControl<boolean>(true),
  });

  // ── Create drawer ────────────────────────────────────────
  createDrawerOpen = signal(false);
  creating = signal(false);
  createError = signal('');

  createForm = new FormGroup({
    email: new FormControl('', [Validators.required, Validators.email]),
    fullName: new FormControl('', [Validators.required, Validators.maxLength(150)]),
    roleId: new FormControl<number | null>(null),
  });

  // ── Password reset ───────────────────────────────────────
  resettingId = signal<string | null>(null);
  resetMessage = signal<{ userId: string; text: string } | null>(null);

  // ── Delete ───────────────────────────────────────────────
  deletingId = signal<string | null>(null);

  // ── Computed ─────────────────────────────────────────────
  filtered = computed(() => {
    const q = this.searchQuery().toLowerCase().trim();
    const status = this.selectedStatus();
    return this.usuarios().filter((u) => {
      if (q && !u.nombre.toLowerCase().includes(q) && !u.email.toLowerCase().includes(q)) {
        return false;
      }
      if (status === 'active' && !u.activo) return false;
      if (status === 'inactive' && u.activo) return false;
      return true;
    });
  });

  drawerTitle = computed(() => {
    const u = this.editingUser();
    return u ? `Editar: ${u.nombre}` : 'Editar usuario';
  });

  async ngOnInit() {
    await this.loadAll();
  }

  private async loadAll() {
    this.loading.set(true);
    this.error.set('');
    try {
      const [usuarios, roles] = await Promise.all([
        this.adminService.getAllUsuarios(),
        this.adminService.getAllRoles(),
      ]);
      this.usuarios.set(usuarios);
      this.roles.set(roles);
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'Error al cargar datos.');
    } finally {
      this.loading.set(false);
    }
  }

  onSearch(value: string) {
    this.searchQuery.set(value);
  }

  onStatusChange(value: string) {
    this.selectedStatus.set(value as 'all' | 'active' | 'inactive');
  }

  openEdit(usuario: UsuarioAdmin) {
    this.editingUser.set(usuario);
    this.saveError.set('');
    this.form.reset({ nombre: usuario.nombre, activo: usuario.activo });
    this.selectedRolIds.set(usuario.roles?.map((ur) => ur.rol.id) ?? []);
    this.drawerOpen.set(true);
  }

  closeDrawer() {
    this.drawerOpen.set(false);
  }

  openCreate() {
    this.createError.set('');
    this.createForm.reset({ email: '', fullName: '', roleId: null });
    this.createDrawerOpen.set(true);
  }

  closeCreateDrawer() {
    this.createDrawerOpen.set(false);
  }

  async onCreateSave() {
    this.createForm.markAllAsTouched();
    if (this.createForm.invalid || this.creating()) return;

    this.creating.set(true);
    this.createError.set('');

    try {
      await this.adminService.createUsuario({
        email: this.createForm.value.email!.trim(),
        fullName: this.createForm.value.fullName!.trim(),
        roleId: this.createForm.value.roleId ?? null,
      });
      const updated = await this.adminService.getAllUsuarios();
      this.usuarios.set(updated);
      this.createDrawerOpen.set(false);
    } catch (e: unknown) {
      this.createError.set(e instanceof Error ? e.message : 'Error al crear el usuario.');
    } finally {
      this.creating.set(false);
    }
  }

  async resetPassword(usuario: UsuarioAdmin) {
    this.resettingId.set(usuario.id);
    this.resetMessage.set(null);
    try {
      const result = await this.adminService.resetPassword(usuario.id);
      this.resetMessage.set({
        userId: usuario.id,
        text: result.sent
          ? 'Correo de restablecimiento enviado.'
          : `No se pudo enviar el correo. Enlace: ${result.actionLink}`,
      });
    } catch (e: unknown) {
      this.resetMessage.set({
        userId: usuario.id,
        text: e instanceof Error ? e.message : 'Error al restablecer la contraseña.',
      });
    } finally {
      this.resettingId.set(null);
    }
  }

  /** Resends the invitation link to a user who hasn't accepted yet. */
  async resendInvite(usuario: UsuarioAdmin) {
    this.resettingId.set(usuario.id);
    this.resetMessage.set(null);
    try {
      const result = await this.adminService.resendInvite(usuario.id);
      this.resetMessage.set({
        userId: usuario.id,
        text: result.sent
          ? 'Invitación reenviada por correo (válida 24 h).'
          : `No se pudo enviar el correo. Enlace: ${result.actionLink}`,
      });
    } catch (e: unknown) {
      this.resetMessage.set({
        userId: usuario.id,
        text: e instanceof Error ? e.message : 'Error al reenviar la invitación.',
      });
    } finally {
      this.resettingId.set(null);
    }
  }

  /** Only actually removes the user if they have zero associated records anywhere — Postgres enforces this. */
  async deleteUsuario(usuario: UsuarioAdmin) {
    if (this.isSelf(usuario)) return;
    if (!confirm(`¿Eliminar permanentemente a "${usuario.nombre}"? Esta acción no se puede deshacer.`)) return;

    this.deletingId.set(usuario.id);
    this.error.set('');
    try {
      await this.adminService.deleteUsuario(usuario.id);
      this.usuarios.update((list) => list.filter((u) => u.id !== usuario.id));
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'Error al eliminar el usuario.');
    } finally {
      this.deletingId.set(null);
    }
  }

  get cf() {
    return this.createForm.controls;
  }

  isRolSelected(rolId: number): boolean {
    return this.selectedRolIds().includes(rolId);
  }

  toggleRol(rolId: number) {
    this.selectedRolIds.update((ids) =>
      ids.includes(rolId) ? ids.filter((id) => id !== rolId) : [...ids, rolId],
    );
  }

  isSelf(usuario: UsuarioAdmin): boolean {
    return usuario.id === this.userService.profile()?.id;
  }

  async onSave() {
    this.form.markAllAsTouched();
    if (this.form.invalid || this.saving()) return;

    const usuario = this.editingUser();
    if (!usuario) return;

    if (this.isSelf(usuario)) {
      const keepsAdmin = this.roles()
        .filter((r) => this.selectedRolIds().includes(r.id))
        .some((r) => r.codigo === 'admin');
      if (!this.form.value.activo || !keepsAdmin) {
        this.saveError.set('No puedes desactivar tu propia cuenta ni quitarte el rol de administrador a ti mismo.');
        return;
      }
    }

    this.saving.set(true);
    this.saveError.set('');

    try {
      const currentUserId = this.userService.profile()?.id ?? '';
      await this.adminService.updateUsuario(usuario.id, this.form.value.nombre!);
      if (this.form.value.activo !== usuario.activo) {
        // Routed through toggleActivo (not a direct field update) so a
        // deactivation here also bans the user at the Auth layer, same as
        // the row-level toggle.
        await this.adminService.toggleActivo(usuario.id, this.form.value.activo!);
      }
      await this.adminService.assignRoles(usuario.id, this.selectedRolIds(), currentUserId);

      // Reload to get updated roles
      const updated = await this.adminService.getAllUsuarios();
      this.usuarios.set(updated);
      this.drawerOpen.set(false);
    } catch (e: unknown) {
      this.saveError.set(e instanceof Error ? e.message : 'Error al guardar.');
    } finally {
      this.saving.set(false);
    }
  }

  async toggleActivo(usuario: UsuarioAdmin) {
    if (this.isSelf(usuario)) return;

    const next = !usuario.activo;
    this.usuarios.update((list) =>
      list.map((u) => (u.id === usuario.id ? { ...u, activo: next } : u)),
    );
    try {
      await this.adminService.toggleActivo(usuario.id, next);
    } catch {
      this.usuarios.update((list) =>
        list.map((u) => (u.id === usuario.id ? { ...u, activo: !next } : u)),
      );
    }
  }

  getUserRolesLabel(usuario: UsuarioAdmin): string {
    return usuario.roles?.map((ur) => ur.rol.nombre).join(', ') || '—';
  }

  get f() {
    return this.form.controls;
  }
}
