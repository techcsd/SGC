import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  computed,
  OnInit,
} from '@angular/core';
import { Router } from '@angular/router';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { AdminService, UsuarioAdmin } from '../../../../shared/services/admin.service';
import { SupabaseService } from '../../../core/services/supabase.service';
import { UserService } from '../../../core/services/user.service';
import { AuthService } from '../../../core/services/auth.service';
import { Rol } from '../../../../shared/models/usuario.model';
import { FormDrawer } from '../../../../shared/components/form-drawer/form-drawer';
import { formatFechaMedia, formatFechaRelativa } from '../../../../shared/utils/fecha.util';
import { Skeleton } from '../../../../shared/components/skeleton/skeleton';
import { Paginator } from '../../../../shared/ui/paginator/paginator';
import { ExportExcel, ExportColumn, ExportSection } from '../../../../shared/components/export-excel/export-excel';

type SortKey = 'nombre' | 'web' | 'app';

@Component({
  selector: 'app-admin-usuarios',
  imports: [ReactiveFormsModule, FormDrawer, Skeleton, Paginator, ExportExcel],
  templateUrl: './usuarios.html',
  styleUrl: './usuarios.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminUsuarios implements OnInit {
  private adminService = inject(AdminService);
  private userService = inject(UserService);
  private supabase = inject(SupabaseService);
  private auth = inject(AuthService);
  private router = inject(Router);

  // AZ10 — "Entrar como" (impersonación de soporte).
  entrandoComoId = signal<string | null>(null);

  /** ¿El usuario objetivo es admin? (no se puede impersonar a otro admin). */
  esUsuarioAdmin(u: UsuarioAdmin): boolean {
    return (u.roles ?? []).some((r) => r.rol?.codigo === 'admin');
  }

  async entrarComo(u: UsuarioAdmin) {
    this.closeMenu();
    if (this.isSelf(u) || this.esUsuarioAdmin(u) || this.entrandoComoId()) return;
    if (!confirm(`¿Entrar como "${u.nombre}"? Verás el sistema como este usuario. Todo queda registrado en la auditoría; sal con el banner superior.`)) return;
    this.entrandoComoId.set(u.id);
    try {
      const { error } = await this.auth.entrarComoUsuario(u.id);
      if (error) { this.error.set(error); this.entrandoComoId.set(null); return; }
      window.location.assign('/'); // recarga completa para cargar el perfil del objetivo
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'No se pudo entrar como el usuario.');
      this.entrandoComoId.set(null);
    }
  }

  formatFecha = formatFechaMedia; // U9
  formatRelativa = formatFechaRelativa; // W12

  // ── W10 — detalle de usuario (drawer) ────────────────────
  detailUser = signal<UsuarioAdmin | null>(null);
  detailOpen = signal(false);

  // ── W12 — orden por columnas (incl. última actividad) ────
  sortKey = signal<SortKey>('nombre');
  sortDir = signal<'asc' | 'desc'>('asc');

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

  // ── Pagination ───────────────────────────────────────────
  page = signal(1);
  readonly PAGE_SIZE = 20;

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
  // AZ7 — un solo lugar para crear ambos tipos: invitación por correo o usuario de prueba (sin correo).
  createTipo = signal<'invitacion' | 'prueba'>('invitacion');
  createRolIds = signal<number[]>([]);
  createResult = signal<{ email: string; password: string } | null>(null);
  // AZ7 — marcar/desmarcar como prueba
  marcandoId = signal<string | null>(null);

  createForm = new FormGroup({
    email: new FormControl('', [Validators.required, Validators.email]),
    fullName: new FormControl('', [Validators.required, Validators.maxLength(150)]),
    roleId: new FormControl<number | null>(null),
  });

  toggleCreateRol(id: number, checked: boolean) {
    this.createRolIds.update((ids) => (checked ? [...new Set([...ids, id])] : ids.filter((x) => x !== id)));
  }

  // ── Password reset ───────────────────────────────────────
  resettingId = signal<string | null>(null);
  resetMessage = signal<{ userId: string; text: string } | null>(null);

  // ── Delete ───────────────────────────────────────────────
  deletingId = signal<string | null>(null);

  // ── P1 — menú de acciones "⋯" por fila (responsive) ──────
  // El menú es un popover position:fixed anclado a la posición del botón para no
  // recortarse dentro del contenedor con overflow del table-wrap.
  openMenuId = signal<string | null>(null);
  menuUser = signal<UsuarioAdmin | null>(null);
  menuPos = signal<{ top: number; right: number } | null>(null);

  openMenu(usuario: UsuarioAdmin, ev: MouseEvent) {
    if (this.openMenuId() === usuario.id) {
      this.closeMenu();
      return;
    }
    const rect = (ev.currentTarget as HTMLElement).getBoundingClientRect();
    this.menuPos.set({ top: rect.bottom + 4, right: Math.max(8, window.innerWidth - rect.right) });
    this.menuUser.set(usuario);
    this.openMenuId.set(usuario.id);
  }

  closeMenu() {
    this.openMenuId.set(null);
    this.menuUser.set(null);
    this.menuPos.set(null);
  }

  // ── Export a Excel (con seccionado por estado / rol) ─────
  private rolesDe(u: UsuarioAdmin): string[] {
    return (u.roles ?? []).map((ur) => ur.rol.nombre);
  }
  readonly exportCols: ExportColumn[] = [
    { key: 'nombre', label: 'Nombre', value: (r) => (r as UsuarioAdmin).nombre },
    { key: 'email', label: 'Email', value: (r) => (r as UsuarioAdmin).email },
    { key: 'estado', label: 'Estado', value: (r) => ((r as UsuarioAdmin).activo ? 'Activo' : 'Inactivo') },
    { key: 'roles', label: 'Roles', value: (r) => this.rolesDe(r as UsuarioAdmin).join(', ') },
    { key: 'acceso_conductor', label: 'Acceso conductor', value: (r) => ((r as UsuarioAdmin).conductores?.length ? 'Sí' : 'No') },
    { key: 'ult_web', label: 'Última actividad web', value: (r) => { const d = (r as UsuarioAdmin).ultima_actividad_web; return d ? formatFechaMedia(d) : ''; } },
    { key: 'ult_app', label: 'Última actividad app', value: (r) => { const d = (r as UsuarioAdmin).ultima_actividad_app; return d ? formatFechaMedia(d) : ''; } },
  ];
  readonly exportSecciones: ExportSection[] = [
    { key: 'estado', label: 'Estado', values: (r) => [(r as UsuarioAdmin).activo ? 'Activo' : 'Inactivo'] },
    { key: 'rol', label: 'Rol', values: (r) => this.rolesDe(r as UsuarioAdmin) },
  ];

  /** P1 — tooltip con los roles no mostrados (a partir del 3.º) en el chip "+N". */
  rolesRestantesTitle(usuario: UsuarioAdmin): string {
    return usuario.roles
      .slice(2)
      .map((ur) => ur.rol.nombre)
      .join(', ');
  }

  // ── Computed ─────────────────────────────────────────────
  filtered = computed(() => {
    const q = this.searchQuery().toLowerCase().trim();
    const status = this.selectedStatus();
    const list = this.usuarios().filter((u) => {
      if (q && !u.nombre.toLowerCase().includes(q) && !u.email.toLowerCase().includes(q)) {
        return false;
      }
      if (status === 'active' && !u.activo) return false;
      if (status === 'inactive' && u.activo) return false;
      return true;
    });
    // W12 — orden por columna (nombre / última actividad web / app).
    const key = this.sortKey();
    const dir = this.sortDir() === 'asc' ? 1 : -1;
    const val = (u: UsuarioAdmin): string | number => {
      if (key === 'nombre') return u.nombre.toLowerCase();
      const d = key === 'web' ? u.ultima_actividad_web : u.ultima_actividad_app;
      return d ? new Date(d).getTime() : 0; // sin actividad al final en asc
    };
    return [...list].sort((a, b) => {
      const va = val(a);
      const vb = val(b);
      if (va < vb) return -1 * dir;
      if (va > vb) return 1 * dir;
      return 0;
    });
  });

  setSort(key: SortKey) {
    if (this.sortKey() === key) {
      this.sortDir.update((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      this.sortKey.set(key);
      // La actividad más útil primero: fechas descendente por defecto.
      this.sortDir.set(key === 'nombre' ? 'asc' : 'desc');
    }
    this.page.set(1);
  }

  // ── W10 — detalle de usuario ─────────────────────────────
  openDetail(usuario: UsuarioAdmin) {
    this.detailUser.set(usuario);
    this.detailOpen.set(true);
  }
  closeDetail() {
    this.detailOpen.set(false);
  }

  /** Avatar público del usuario (bucket sgc-avatars) o null. */
  avatarUrlDe(usuario: UsuarioAdmin | null): string | null {
    if (!usuario?.avatar_path) return null;
    return this.supabase.client.storage.from('sgc-avatars').getPublicUrl(usuario.avatar_path).data
      .publicUrl;
  }

  /** Perfil de conductor vinculado (el primero si hay), o null. */
  conductorDe(usuario: UsuarioAdmin | null): { id: string; nombre: string } | null {
    return usuario?.conductores?.[0] ?? null;
  }

  irAConductor(id: string) {
    this.closeDetail();
    void this.router.navigate(['/flota/conductores', id]);
  }

  /** AN4 — abre la página de Roles enfocada en los accesos efectivos de este usuario. */
  verAccesos(usuario: UsuarioAdmin) {
    this.closeDetail();
    void this.router.navigate(['/admin/roles'], { queryParams: { usuario: usuario.id } });
  }

  /** Texto relativo de actividad, con guion si nunca. */
  actividad(fecha: string | null | undefined): string {
    return fecha ? this.formatRelativa(fecha) : '—';
  }

  paginated = computed(() => {
    const start = (this.page() - 1) * this.PAGE_SIZE;
    return this.filtered().slice(start, start + this.PAGE_SIZE);
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
    this.page.set(1);
  }

  onStatusChange(value: string) {
    this.selectedStatus.set(value as 'all' | 'active' | 'inactive');
    this.page.set(1);
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
    this.createTipo.set('invitacion');
    this.createRolIds.set([]);
    this.createResult.set(null);
    this.createForm.reset({ email: '', fullName: '', roleId: null });
    this.createDrawerOpen.set(true);
  }

  closeCreateDrawer() {
    this.createDrawerOpen.set(false);
  }

  async onCreateSave() {
    if (this.creating()) return;

    // AZ7 — usuario de prueba (sin correo): reusa el flujo de "Usuarios de prueba".
    if (this.createTipo() === 'prueba') {
      const nombre = this.createForm.value.fullName?.trim();
      if (!nombre) { this.createForm.controls.fullName.markAsTouched(); return; }
      this.creating.set(true);
      this.createError.set('');
      try {
        const cred = await this.adminService.crearUsuarioTest(nombre, this.createRolIds());
        this.createResult.set({ email: cred.email, password: cred.password });
        this.usuarios.set(await this.adminService.getAllUsuarios());
      } catch (e: unknown) {
        this.createError.set(e instanceof Error ? e.message : 'Error al crear el usuario de prueba.');
      } finally {
        this.creating.set(false);
      }
      return;
    }

    // Invitación por correo (flujo existente).
    this.createForm.markAllAsTouched();
    if (this.createForm.invalid) return;
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

  /** AZ7 — marca/desmarca un usuario como de prueba (con aviso de consecuencias). */
  async togglePrueba(usuario: UsuarioAdmin) {
    this.closeMenu();
    if (this.isSelf(usuario)) return;
    const marcar = !usuario.es_prueba;
    const msg = marcar
      ? `¿Marcar a "${usuario.nombre}" como usuario de PRUEBA? Quedará fuera de KPIs, correos e incentivos, y oculto de los listados salvo el toggle de datos de prueba.`
      : `¿Quitar la marca de prueba a "${usuario.nombre}"? Volverá a contar como usuario real (KPIs, correos, incentivos).`;
    if (!confirm(msg)) return;
    this.marcandoId.set(usuario.id);
    try {
      await this.adminService.marcarUsuarioPrueba(usuario.id, marcar);
      this.usuarios.update((list) => list.map((u) => (u.id === usuario.id ? { ...u, es_prueba: marcar } : u)));
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'No se pudo cambiar la marca de prueba.');
    } finally {
      this.marcandoId.set(null);
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
