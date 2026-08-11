import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  computed,
  OnInit,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import {
  RolesService,
  Rol,
  MODULOS_DISPONIBLES,
  SUBMODULOS,
  PermisosMap,
  NivelPermiso,
  SubmoduloInfo,
  AccesosEfectivos,
  UsuarioMultiRol,
} from '../../../../shared/services/roles.service';
import { AdminService, UsuarioAdmin } from '../../../../shared/services/admin.service';
import { ToastService } from '../../../../shared/services/toast.service';
import { FormDrawer } from '../../../../shared/components/form-drawer/form-drawer';
import { Skeleton } from '../../../../shared/components/skeleton/skeleton';
import { Paginator } from '../../../../shared/ui/paginator/paginator';
import { RolePermisosEditor } from './role-permisos-editor';

/** Fila de la vista "accesos efectivos" ya resuelta a etiquetas legibles. */
interface AccesoModuloVista {
  key: string;
  label: string;
  submodulos: { label: string; nivel: NivelPermiso }[];
}

/** Cambio en el diff de submódulos al quitar/agregar roles. */
interface DiffSubmodulo {
  label: string;
  antes?: NivelPermiso;
  despues?: NivelPermiso;
}

@Component({
  selector: 'app-admin-roles',
  imports: [ReactiveFormsModule, RouterLink, FormDrawer, Skeleton, Paginator, RolePermisosEditor],
  templateUrl: './roles.html',
  styleUrl: './roles.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminRoles implements OnInit {
  private rolesService = inject(RolesService);
  private adminService = inject(AdminService);
  private toast = inject(ToastService);
  private route = inject(ActivatedRoute);

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
  // AG12 — permisos granulares por submódulo (edición).
  selectedPermisos = signal<PermisosMap>({});
  mostrarAvanzado = signal(false);

  readonly modulos = MODULOS_DISPONIBLES;
  readonly submodulosPorModulo = SUBMODULOS;
  /** Módulos que tienen submódulos configurables. */
  readonly modulosConSubmodulos = MODULOS_DISPONIBLES.filter((m) => !!SUBMODULOS[m.key]);
  submodulosDe(moduloKey: string): SubmoduloInfo[] { return SUBMODULOS[moduloKey] ?? []; }

  form = new FormGroup({
    nombre: new FormControl('', [Validators.required, Validators.maxLength(100)]),
    descripcion: new FormControl('', [Validators.maxLength(500)]),
  });

  // ── Create drawer ────────────────────────────────────────
  createDrawerOpen = signal(false);
  creating = signal(false);
  createError = signal('');
  createSelectedModulos = signal<string[]>([]);
  createSelectedPermisos = signal<PermisosMap>({});
  createMostrarAvanzado = signal(false);

  createForm = new FormGroup({
    nombre: new FormControl('', [Validators.required, Validators.maxLength(100)]),
    descripcion: new FormControl('', [Validators.maxLength(500)]),
  });

  deletingId = signal<number | null>(null);
  deleteError = signal('');

  // ── AN2 — indicador "cambios sin guardar" ────────────────
  // Los campos de texto viven en el FormGroup (no en signals); se puentea su
  // valueChanges a una signal para que el computed reaccione con OnPush.
  private editFormSig = toSignal(this.form.valueChanges, { initialValue: this.form.getRawValue() });
  private createFormSig = toSignal(this.createForm.valueChanges, { initialValue: this.createForm.getRawValue() });

  editDirty = computed(() => {
    const r = this.editingRol();
    if (!r) return false;
    const fv = this.editFormSig();
    if ((fv.nombre ?? '') !== (r.nombre ?? '')) return true;
    if ((fv.descripcion ?? '') !== (r.descripcion ?? '')) return true;
    if (!arraysIguales(this.selectedModulos(), r.modulos ?? [])) return true;
    return !permisosIguales(this.selectedPermisos(), r.permisos ?? {});
  });

  createDirty = computed(() => {
    const fv = this.createFormSig();
    return (
      !!(fv.nombre ?? '').trim() ||
      !!(fv.descripcion ?? '').trim() ||
      this.createSelectedModulos().length > 0 ||
      Object.keys(this.createSelectedPermisos()).length > 0
    );
  });

  // ── Pagination ───────────────────────────────────────────
  page = signal(1);
  readonly PAGE_SIZE = 15;

  paginated = computed(() => {
    const start = (this.page() - 1) * this.PAGE_SIZE;
    return this.roles().slice(start, start + this.PAGE_SIZE);
  });

  // ── Computed ─────────────────────────────────────────────
  drawerTitle = computed(() => {
    const r = this.editingRol();
    return r ? `Editar rol: ${r.nombre}` : 'Editar rol';
  });

  async ngOnInit() {
    await this.loadRoles();
    // Carga usuarios (para los selectores de auditoría) en segundo plano.
    void this.loadUsuarios();
    // Deep-link desde Usuarios: /admin/roles?usuario=<id> abre "accesos por usuario".
    const usuarioId = this.route.snapshot.queryParamMap.get('usuario');
    if (usuarioId) {
      this.auditTab.set('efectivos');
      this.auditFuente.set('usuario');
      this.auditUsuarioId.set(usuarioId);
      void this.cargarAccesosUsuario(usuarioId);
    }
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

  private async loadUsuarios() {
    try {
      this.usuarios.set(await this.adminService.getAllUsuarios());
    } catch {
      /* no bloquea la página de roles */
    }
  }

  openEdit(rol: Rol) {
    this.editingRol.set(rol);
    this.saveError.set('');
    this.form.reset({ nombre: rol.nombre, descripcion: rol.descripcion ?? '' });
    this.selectedModulos.set([...(rol.modulos ?? [])]);
    this.selectedPermisos.set({ ...(rol.permisos ?? {}) });
    this.mostrarAvanzado.set(Object.keys(rol.permisos ?? {}).length > 0);
    this.drawerOpen.set(true);
  }

  // ── AG12 — permisos granulares (edición) ─────────────────
  permisoNivel(key: string): NivelPermiso | '' {
    return this.selectedPermisos()[key] ?? '';
  }
  setPermiso(key: string, nivel: string) {
    this.selectedPermisos.update((p) => {
      const next = { ...p };
      if (nivel === 'ver' || nivel === 'operar') next[key] = nivel;
      else delete next[key];
      return next;
    });
  }
  /** Un submódulo queda implícito en 'operar' si su módulo padre está marcado. */
  submoduloImplicito(subKey: string): boolean {
    return this.selectedModulos().includes(subKey.split('.')[0]);
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

  openCreate() {
    this.createError.set('');
    this.createForm.reset({ nombre: '', descripcion: '' });
    this.createSelectedModulos.set([]);
    this.createSelectedPermisos.set({});
    this.createMostrarAvanzado.set(false);
    this.createDrawerOpen.set(true);
  }

  createPermisoNivel(key: string): NivelPermiso | '' {
    return this.createSelectedPermisos()[key] ?? '';
  }
  setCreatePermiso(key: string, nivel: string) {
    this.createSelectedPermisos.update((p) => {
      const next = { ...p };
      if (nivel === 'ver' || nivel === 'operar') next[key] = nivel;
      else delete next[key];
      return next;
    });
  }
  createSubmoduloImplicito(subKey: string): boolean {
    return this.createSelectedModulos().includes(subKey.split('.')[0]);
  }

  closeCreateDrawer() {
    this.createDrawerOpen.set(false);
  }

  isCreateModuloSelected(key: string): boolean {
    return this.createSelectedModulos().includes(key);
  }

  toggleCreateModulo(key: string) {
    this.createSelectedModulos.update((mods) =>
      mods.includes(key) ? mods.filter((m) => m !== key) : [...mods, key],
    );
  }

  async onCreateSave() {
    this.createForm.markAllAsTouched();
    if (this.createForm.invalid || this.creating()) return;

    if (this.createSelectedModulos().length === 0 && Object.keys(this.createSelectedPermisos()).length === 0) {
      this.createError.set('Selecciona al menos un módulo o un permiso de submódulo para el rol.');
      return;
    }

    this.creating.set(true);
    this.createError.set('');

    try {
      await this.rolesService.create({
        nombre: this.createForm.value.nombre!,
        modulos: this.createSelectedModulos(),
        permisos: this.createSelectedPermisos(),
        descripcion: this.createForm.value.descripcion ?? '',
      });
      const updated = await this.rolesService.getAll();
      this.roles.set(updated);
      this.createDrawerOpen.set(false);
    } catch (e: unknown) {
      this.createError.set(e instanceof Error ? e.message : 'Error al crear el rol.');
    } finally {
      this.creating.set(false);
    }
  }

  async deleteRol(rol: Rol) {
    if (!confirm(`¿Eliminar el rol "${rol.nombre}"? Esta acción no se puede deshacer.`)) return;

    this.deletingId.set(rol.id);
    this.deleteError.set('');
    try {
      await this.rolesService.delete(rol.id);
      this.roles.update((list) => list.filter((r) => r.id !== rol.id));
    } catch (e: unknown) {
      this.deleteError.set(e instanceof Error ? e.message : 'Error al eliminar el rol.');
    } finally {
      this.deletingId.set(null);
    }
  }

  get cf() {
    return this.createForm.controls;
  }

  getModuloLabel(key: string): string {
    return this.modulos.find((m) => m.key === key)?.label ?? key;
  }

  getModuloDesc(key: string): string {
    return this.modulos.find((m) => m.key === key)?.desc ?? '';
  }

  // ═══════════════════════════════════════════════════════════
  // AN4 — Auditoría de roles
  // ═══════════════════════════════════════════════════════════

  usuarios = signal<UsuarioAdmin[]>([]);
  /** Pestaña activa del panel de auditoría. */
  auditTab = signal<'efectivos' | 'multirol' | 'diff'>('efectivos');

  /** Etiqueta de un módulo o, si es "modulo.submodulo", del submódulo. */
  private labelSubmodulo(key: string): string {
    const sub = (SUBMODULOS[key.split('.')[0]] ?? []).find((s) => s.key === key);
    return sub?.label ?? key;
  }

  /** Convierte un JSONB de accesos efectivos en filas legibles por módulo. */
  private aVista(acc: AccesosEfectivos): AccesoModuloVista[] {
    const vistas = new Map<string, AccesoModuloVista>();
    const asegura = (modKey: string): AccesoModuloVista => {
      let v = vistas.get(modKey);
      if (!v) {
        v = { key: modKey, label: this.getModuloLabel(modKey), submodulos: [] };
        vistas.set(modKey, v);
      }
      return v;
    };
    for (const m of acc.modulos) asegura(m);
    for (const [k, nivel] of Object.entries(acc.submodulos)) {
      asegura(k.split('.')[0]).submodulos.push({ label: this.labelSubmodulo(k), nivel });
    }
    // Módulos ordenados según el catálogo; submódulos por etiqueta.
    return this.modulos
      .map((m) => vistas.get(m.key))
      .filter((v): v is AccesoModuloVista => !!v)
      .map((v) => ({ ...v, submodulos: [...v.submodulos].sort((a, b) => a.label.localeCompare(b.label)) }));
  }

  // ── 1) Accesos efectivos (por rol / por usuario) ─────────
  auditFuente = signal<'rol' | 'usuario'>('rol');
  auditRolId = signal<number | null>(null);
  auditUsuarioId = signal<string | null>(null);
  auditLoading = signal(false);
  auditAccesos = signal<AccesoModuloVista[] | null>(null);
  auditVacio = signal(false);

  setAuditFuente(f: 'rol' | 'usuario') {
    this.auditFuente.set(f);
    this.auditAccesos.set(null);
    this.auditVacio.set(false);
  }

  onSelectAuditRol(value: string) {
    const id = value ? Number(value) : null;
    this.auditRolId.set(id);
    if (id != null) void this.cargarAccesosRol(id);
    else this.auditAccesos.set(null);
  }

  onSelectAuditUsuario(value: string) {
    const id = value || null;
    this.auditUsuarioId.set(id);
    if (id) void this.cargarAccesosUsuario(id);
    else this.auditAccesos.set(null);
  }

  private async cargarAccesosRol(id: number) {
    this.auditLoading.set(true);
    try {
      const acc = await this.rolesService.accesosEfectivosRol(id);
      const vista = this.aVista(acc);
      this.auditAccesos.set(vista);
      this.auditVacio.set(vista.length === 0);
    } catch (e: unknown) {
      this.toast.error('No se pudieron cargar los accesos', e instanceof Error ? e.message : undefined);
      this.auditAccesos.set(null);
    } finally {
      this.auditLoading.set(false);
    }
  }

  private async cargarAccesosUsuario(id: string) {
    this.auditLoading.set(true);
    try {
      const acc = await this.rolesService.accesosEfectivosUsuario(id);
      const vista = this.aVista(acc);
      this.auditAccesos.set(vista);
      this.auditVacio.set(vista.length === 0);
    } catch (e: unknown) {
      this.toast.error('No se pudieron cargar los accesos', e instanceof Error ? e.message : undefined);
      this.auditAccesos.set(null);
    } finally {
      this.auditLoading.set(false);
    }
  }

  // ── 2) Reporte multi-rol ─────────────────────────────────
  multiRol = signal<UsuarioMultiRol[] | null>(null);
  multiRolLoading = signal(false);

  async cargarMultiRol() {
    if (this.multiRol() || this.multiRolLoading()) return;
    this.multiRolLoading.set(true);
    try {
      this.multiRol.set(await this.rolesService.usuariosMultiRol());
    } catch (e: unknown) {
      this.toast.error('No se pudo cargar el reporte', e instanceof Error ? e.message : undefined);
    } finally {
      this.multiRolLoading.set(false);
    }
  }

  modulosLabels(keys: string[]): string {
    return keys.map((k) => this.getModuloLabel(k)).join(', ');
  }

  /** Carga a este usuario en la herramienta de diff ("simular quitar roles"). */
  simularUsuario(usuarioId: string) {
    this.auditTab.set('diff');
    this.onSelectDiffUsuario(usuarioId);
  }

  // ── 3) Diff al quitar roles ──────────────────────────────
  diffUsuarioId = signal<string | null>(null);
  diffRolesActuales = signal<number[]>([]);
  diffRolesPropuestos = signal<number[]>([]);
  diffLoading = signal(false);
  diffResultado = signal<{
    modulosPierde: string[];
    modulosGana: string[];
    subsPierde: DiffSubmodulo[];
    subsGana: DiffSubmodulo[];
    subsCambia: DiffSubmodulo[];
  } | null>(null);

  onSelectDiffUsuario(value: string) {
    const id = value || null;
    this.diffUsuarioId.set(id);
    this.diffResultado.set(null);
    if (!id) {
      this.diffRolesActuales.set([]);
      this.diffRolesPropuestos.set([]);
      return;
    }
    const u = this.usuarios().find((x) => x.id === id);
    const ids = (u?.roles ?? []).map((ur) => ur.rol.id);
    this.diffRolesActuales.set(ids);
    this.diffRolesPropuestos.set([...ids]);
  }

  isDiffRolPropuesto(rolId: number): boolean {
    return this.diffRolesPropuestos().includes(rolId);
  }

  toggleDiffRol(rolId: number) {
    this.diffRolesPropuestos.update((ids) =>
      ids.includes(rolId) ? ids.filter((i) => i !== rolId) : [...ids, rolId],
    );
    this.diffResultado.set(null);
  }

  get diffSinCambios(): boolean {
    return arraysIguales(this.diffRolesActuales(), this.diffRolesPropuestos());
  }

  async calcularDiff() {
    if (!this.diffUsuarioId() || this.diffSinCambios) return;
    this.diffLoading.set(true);
    try {
      const [antes, despues] = await Promise.all([
        this.rolesService.accesosEfectivosDeRoles(this.diffRolesActuales()),
        this.rolesService.accesosEfectivosDeRoles(this.diffRolesPropuestos()),
      ]);
      const antesMods = new Set(antes.modulos);
      const despuesMods = new Set(despues.modulos);
      const modulosPierde = antes.modulos.filter((m) => !despuesMods.has(m)).map((m) => this.getModuloLabel(m));
      const modulosGana = despues.modulos.filter((m) => !antesMods.has(m)).map((m) => this.getModuloLabel(m));

      const subsPierde: DiffSubmodulo[] = [];
      const subsGana: DiffSubmodulo[] = [];
      const subsCambia: DiffSubmodulo[] = [];
      const keys = new Set([...Object.keys(antes.submodulos), ...Object.keys(despues.submodulos)]);
      for (const k of keys) {
        const a = antes.submodulos[k];
        const d = despues.submodulos[k];
        if (a && !d) subsPierde.push({ label: this.labelSubmodulo(k), antes: a });
        else if (!a && d) subsGana.push({ label: this.labelSubmodulo(k), despues: d });
        else if (a && d && a !== d) subsCambia.push({ label: this.labelSubmodulo(k), antes: a, despues: d });
      }
      this.diffResultado.set({ modulosPierde, modulosGana, subsPierde, subsGana, subsCambia });
    } catch (e: unknown) {
      this.toast.error('No se pudo calcular el impacto', e instanceof Error ? e.message : undefined);
    } finally {
      this.diffLoading.set(false);
    }
  }

  get diffSinImpacto(): boolean {
    const r = this.diffResultado();
    return (
      !!r &&
      r.modulosPierde.length === 0 &&
      r.modulosGana.length === 0 &&
      r.subsPierde.length === 0 &&
      r.subsGana.length === 0 &&
      r.subsCambia.length === 0
    );
  }

  async onSave() {
    this.form.markAllAsTouched();
    if (this.form.invalid || this.saving()) return;

    const rol = this.editingRol();
    if (!rol) return;

    if (this.selectedModulos().length === 0 && Object.keys(this.selectedPermisos()).length === 0) {
      this.saveError.set('El rol debe tener al menos un módulo o un permiso de submódulo.');
      return;
    }

    this.saving.set(true);
    this.saveError.set('');

    try {
      await this.rolesService.update(rol.id, {
        nombre: this.form.value.nombre!,
        modulos: this.selectedModulos(),
        permisos: this.selectedPermisos(),
        descripcion: this.form.value.descripcion ?? '',
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

/** Igualdad de dos listas de strings sin importar el orden. */
function arraysIguales(a: string[] | number[], b: string[] | number[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.every((v, i) => v === sb[i]);
}

/** Igualdad de dos mapas de permisos. */
function permisosIguales(a: PermisosMap, b: PermisosMap): boolean {
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => a[k] === b[k]);
}
