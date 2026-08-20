import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  computed,
  OnInit,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { DatePipe } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import {
  RolesService,
  Rol,
  MODULOS_DISPONIBLES,
  SUBMODULOS,
  PermisosMap,
  NivelPermiso,
  AccesosEfectivos,
  UsuarioMultiRol,
  PRESETS_CARGO,
  PresetCargo,
  CambioPermisosLog,
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

/** AS4 — resultado del diff de permisos (antes vs editado) para el modal de confirmación. */
interface DiffPermisos {
  modulosGana: string[];
  modulosPierde: string[];
  subsGana: DiffSubmodulo[];
  subsPierde: DiffSubmodulo[];
  subsCambia: DiffSubmodulo[];
  sinImpacto: boolean;
}

@Component({
  selector: 'app-admin-roles',
  imports: [ReactiveFormsModule, RouterLink, DatePipe, FormDrawer, Skeleton, Paginator, RolePermisosEditor],
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
  // AO6 — el rol comparte ubicación por defecto (choferes/transportistas).
  comparteUbicacion = signal(false);

  readonly modulos = MODULOS_DISPONIBLES;
  /** AS4 — presets por cargo (plantillas de arranque). */
  readonly presets: PresetCargo[] = PRESETS_CARGO;

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
  createComparteUbicacion = signal(false);

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
    if (this.comparteUbicacion() !== !!r.comparte_ubicacion) return true;
    return !permisosIguales(this.selectedPermisos(), r.permisos ?? {});
  });

  createDirty = computed(() => {
    const fv = this.createFormSig();
    return (
      !!(fv.nombre ?? '').trim() ||
      !!(fv.descripcion ?? '').trim() ||
      this.createSelectedModulos().length > 0 ||
      this.createComparteUbicacion() ||
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
    this.comparteUbicacion.set(!!rol.comparte_ubicacion);
    this.drawerOpen.set(true);
  }

  closeDrawer() {
    this.drawerOpen.set(false);
  }

  openCreate() {
    this.createError.set('');
    this.createForm.reset({ nombre: '', descripcion: '' });
    this.createSelectedModulos.set([]);
    this.createSelectedPermisos.set({});
    this.createComparteUbicacion.set(false);
    this.createDrawerOpen.set(true);
  }

  closeCreateDrawer() {
    this.createDrawerOpen.set(false);
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
        comparte_ubicacion: this.createComparteUbicacion(),
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
  // AS4 — Presets por cargo + copiar permisos de otro rol
  // ═══════════════════════════════════════════════════════════

  /** Roles disponibles para copiar (excluye el que se edita). */
  rolesParaCopiar = computed(() => {
    const editId = this.editingRol()?.id;
    return this.roles().filter((r) => r.id !== editId);
  });

  private aplicarEdit(estado: { modulos: string[]; permisos: PermisosMap; comparte_ubicacion?: boolean }) {
    this.selectedModulos.set([...estado.modulos]);
    this.selectedPermisos.set({ ...estado.permisos });
    this.comparteUbicacion.set(!!estado.comparte_ubicacion);
  }
  private aplicarCreate(estado: { modulos: string[]; permisos: PermisosMap; comparte_ubicacion?: boolean }) {
    this.createSelectedModulos.set([...estado.modulos]);
    this.createSelectedPermisos.set({ ...estado.permisos });
    this.createComparteUbicacion.set(!!estado.comparte_ubicacion);
  }

  onAplicarPreset(key: string) {
    const p = this.presets.find((x) => x.key === key);
    if (p) this.aplicarEdit(p);
  }
  onCopiarRol(value: string) {
    const r = this.roles().find((x) => x.id === Number(value));
    if (r) this.aplicarEdit({ modulos: r.modulos ?? [], permisos: r.permisos ?? {}, comparte_ubicacion: r.comparte_ubicacion });
  }
  onAplicarPresetCreate(key: string) {
    const p = this.presets.find((x) => x.key === key);
    if (p) this.aplicarCreate(p);
  }
  onCopiarRolCreate(value: string) {
    const r = this.roles().find((x) => x.id === Number(value));
    if (r) this.aplicarCreate({ modulos: r.modulos ?? [], permisos: r.permisos ?? {}, comparte_ubicacion: r.comparte_ubicacion });
  }

  // ═══════════════════════════════════════════════════════════
  // AS4 — Diff antes de guardar + auditoría de cambios
  // ═══════════════════════════════════════════════════════════

  /** Acceso EFECTIVO de un estado: módulos sin submódulos (binarios) + nivel por submódulo
   *  (un módulo completo expande a 'operar' en todos sus submódulos). */
  private estadoEfectivo(modulos: string[], permisos: PermisosMap): {
    modulosSinSub: Set<string>;
    subs: PermisosMap;
  } {
    const modulosSinSub = new Set<string>();
    const subs: PermisosMap = {};
    for (const m of this.modulos) {
      const subList = SUBMODULOS[m.key] ?? [];
      const completo = modulos.includes(m.key);
      if (subList.length === 0) {
        if (completo) modulosSinSub.add(m.key);
      } else {
        for (const s of subList) {
          const lvl: NivelPermiso | undefined = completo ? 'operar' : permisos[s.key];
          if (lvl) subs[s.key] = lvl;
        }
      }
    }
    return { modulosSinSub, subs };
  }

  private computeDiffPermisos(
    antes: { modulos: string[]; permisos: PermisosMap },
    despues: { modulos: string[]; permisos: PermisosMap },
  ): DiffPermisos {
    const b = this.estadoEfectivo(antes.modulos, antes.permisos);
    const a = this.estadoEfectivo(despues.modulos, despues.permisos);

    const modulosGana = [...a.modulosSinSub].filter((m) => !b.modulosSinSub.has(m)).map((m) => this.getModuloLabel(m));
    const modulosPierde = [...b.modulosSinSub].filter((m) => !a.modulosSinSub.has(m)).map((m) => this.getModuloLabel(m));

    const subsGana: DiffSubmodulo[] = [];
    const subsPierde: DiffSubmodulo[] = [];
    const subsCambia: DiffSubmodulo[] = [];
    const keys = new Set([...Object.keys(b.subs), ...Object.keys(a.subs)]);
    for (const k of keys) {
      const before = b.subs[k];
      const after = a.subs[k];
      if (!before && after) subsGana.push({ label: this.labelSubmodulo(k), despues: after });
      else if (before && !after) subsPierde.push({ label: this.labelSubmodulo(k), antes: before });
      else if (before && after && before !== after) subsCambia.push({ label: this.labelSubmodulo(k), antes: before, despues: after });
    }
    const sinImpacto =
      modulosGana.length === 0 && modulosPierde.length === 0 &&
      subsGana.length === 0 && subsPierde.length === 0 && subsCambia.length === 0;
    return { modulosGana, modulosPierde, subsGana, subsPierde, subsCambia, sinImpacto };
  }

  // Estado del modal de confirmación de guardado.
  confirmOpen = signal(false);
  pendingDiff = signal<DiffPermisos | null>(null);

  private nivelLabel(n?: NivelPermiso): string {
    return n === 'operar' ? 'Operar' : 'Ver';
  }

  /** Botón "Ver accesos actuales de este rol" — reutiliza accesos_efectivos_rol (AN4). */
  verAccesosActuales() {
    const rol = this.editingRol();
    if (!rol) return;
    this.confirmOpen.set(false);
    this.drawerOpen.set(false);
    this.auditTab.set('efectivos');
    this.auditFuente.set('rol');
    this.auditRolId.set(rol.id);
    void this.cargarAccesosRol(rol.id);
  }

  cancelarGuardar() {
    this.confirmOpen.set(false);
    this.pendingDiff.set(null);
  }

  /** Guarda de verdad (tras confirmar el diff) y registra la auditoría. */
  async confirmarGuardar() {
    const rol = this.editingRol();
    if (!rol || this.saving()) return;

    this.saving.set(true);
    this.saveError.set('');
    const diff = this.pendingDiff();

    try {
      await this.rolesService.update(rol.id, {
        nombre: this.form.value.nombre!,
        modulos: this.selectedModulos(),
        permisos: this.selectedPermisos(),
        descripcion: this.form.value.descripcion ?? '',
        comparte_ubicacion: this.comparteUbicacion(),
      });

      // Auditoría: solo si hubo impacto real en el acceso.
      if (diff && !diff.sinImpacto) {
        const gana = [
          ...diff.modulosGana.map((m) => `${m} (módulo completo)`),
          ...diff.subsGana.map((s) => `${s.label} → ${this.nivelLabel(s.despues)}`),
        ];
        const pierde = [
          ...diff.modulosPierde.map((m) => `${m} (módulo completo)`),
          ...diff.subsPierde.map((s) => `${s.label} (${this.nivelLabel(s.antes)})`),
        ];
        const cambia = diff.subsCambia.map(
          (s) => `${s.label}: ${this.nivelLabel(s.antes)} → ${this.nivelLabel(s.despues)}`,
        );
        try {
          await this.rolesService.registrarCambioPermisos(rol.id, {
            gana, pierde, cambia,
            antes: { modulos: rol.modulos ?? [], permisos: rol.permisos ?? {} },
            despues: { modulos: this.selectedModulos(), permisos: this.selectedPermisos() },
          });
          // Refresca el historial si ya estaba cargado.
          this.historial.set(null);
        } catch {
          // La auditoría no debe bloquear el guardado.
        }
      }

      const updated = await this.rolesService.getAll();
      this.roles.set(updated);
      this.confirmOpen.set(false);
      this.pendingDiff.set(null);
      this.drawerOpen.set(false);
      this.toast.success('Permisos guardados');
    } catch (e: unknown) {
      this.saveError.set(e instanceof Error ? e.message : 'Error al guardar.');
      this.confirmOpen.set(false);
    } finally {
      this.saving.set(false);
    }
  }

  // ═══════════════════════════════════════════════════════════
  // AS4 — Historial de cambios de permisos
  // ═══════════════════════════════════════════════════════════
  historial = signal<CambioPermisosLog[] | null>(null);
  historialLoading = signal(false);

  async cargarHistorial() {
    if (this.historial() || this.historialLoading()) return;
    this.historialLoading.set(true);
    try {
      this.historial.set(await this.rolesService.historialCambiosPermisos(30));
    } catch (e: unknown) {
      this.toast.error('No se pudo cargar el historial', e instanceof Error ? e.message : undefined);
    } finally {
      this.historialLoading.set(false);
    }
  }

  /** Helpers para pintar el resumen textual de una entrada de historial. */
  histLista(cambio: Record<string, unknown>, campo: 'gana' | 'pierde' | 'cambia'): string[] {
    const v = cambio?.[campo];
    return Array.isArray(v) ? (v as string[]) : [];
  }

  // ═══════════════════════════════════════════════════════════
  // AN4 — Auditoría de roles
  // ═══════════════════════════════════════════════════════════

  usuarios = signal<UsuarioAdmin[]>([]);
  /** Pestaña activa del panel de auditoría. */
  auditTab = signal<'efectivos' | 'multirol' | 'diff' | 'historial'>('efectivos');

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

  /** AS4 — al pulsar Guardar: valida y abre el modal de confirmación con el diff. */
  onSave() {
    this.form.markAllAsTouched();
    if (this.form.invalid || this.saving()) return;

    const rol = this.editingRol();
    if (!rol) return;

    if (this.selectedModulos().length === 0 && Object.keys(this.selectedPermisos()).length === 0) {
      this.saveError.set('El rol debe tener al menos un módulo o un permiso de submódulo.');
      return;
    }

    this.saveError.set('');
    this.pendingDiff.set(
      this.computeDiffPermisos(
        { modulos: rol.modulos ?? [], permisos: rol.permisos ?? {} },
        { modulos: this.selectedModulos(), permisos: this.selectedPermisos() },
      ),
    );
    this.confirmOpen.set(true);
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
