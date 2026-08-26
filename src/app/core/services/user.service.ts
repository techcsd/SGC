import { Injectable, inject, signal, computed } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { Usuario } from '../../../shared/models/usuario.model';

const PROFILE_MAX_AGE_MS = 5 * 60 * 1000;

@Injectable({ providedIn: 'root' })
export class UserService {
  private supabase = inject(SupabaseService);

  private _profile = signal<Usuario | null>(null);
  profile = this._profile.asReadonly();
  private loadedAt: number | null = null;

  /** Flat list of role codes the current user has, e.g. ['admin', 'logistica'] */
  roles = computed(() => this._profile()?.roles?.map((ur) => ur.rol.codigo) ?? []);

  /** All module keys the user can access, derived from their roles */
  modulos = computed(() => {
    const all = this._profile()?.roles?.flatMap((ur) => ur.rol.modulos) ?? [];
    return [...new Set(all)];
  });

  hasRole(codigo: string): boolean {
    return this.roles().includes(codigo);
  }

  /**
   * P6 — roles "elevados" de flota: pueden ver vehículos desactivados y
   * activarlos/desactivarlos (además de gestionar la flota). Debe coincidir con
   * la función SQL `sgc.es_flota_elevado()` (fuente de verdad en RLS).
   */
  esFlotaElevado = computed(() =>
    // AS5 — + logistica (Raykler/Misael): logística de transporte necesita
    // seguimiento, rutas, conductores, conduces, combustible y mantenimientos.
    ['admin', 'direccion', 'gerencia', 'jefe_flota', 'logistica'].some((r) => this.roles().includes(r)),
  );

  hasModulo(modulo: string): boolean {
    return this.modulos().includes(modulo);
  }

  /**
   * AY4c — ¿puede GESTIONAR proyectos (crear/editar/borrar la obra)? Tener el módulo
   * `proyectos` por un rol que NO sea `ingeniero_oficina` (oficina lo lleva SOLO para
   * VER todas las obras + costos/presupuesto — cubicaciones — y es solo-lectura sobre
   * la ficha). Espejo de `sgc.puede_gestionar_proyectos()` (la RLS lo fuerza igual).
   */
  puedeGestionarProyectos = computed(
    () =>
      this.hasRole('admin') ||
      (this._profile()?.roles ?? []).some(
        (ur) => ur.rol.codigo !== 'ingeniero_oficina' && (ur.rol.modulos ?? []).includes('proyectos'),
      ),
  );

  /**
   * AG12 — permisos granulares por submódulo. Mapa "modulo.submodulo" → mejor
   * nivel entre todos los roles del usuario. Fuente única en el front (espejo de
   * `sgc.nivel_submodulo`). El checkbox del módulo padre implica 'operar' en todos
   * sus submódulos (compat), de ahí que `nivelSubmodulo` consulte también modulos().
   */
  private permisosMerged = computed<Record<string, 'ver' | 'operar'>>(() => {
    const acc: Record<string, 'ver' | 'operar'> = {};
    for (const ur of this._profile()?.roles ?? []) {
      const p = ur.rol.permisos ?? {};
      for (const [k, v] of Object.entries(p)) {
        if (v === 'operar' || (v === 'ver' && acc[k] !== 'operar')) acc[k] = v;
      }
    }
    return acc;
  });

  /** Nivel efectivo de un submódulo: 'operar' | 'ver' | null. */
  nivelSubmodulo(key: string): 'operar' | 'ver' | null {
    if (this.hasRole('admin')) return 'operar';
    const modulo = key.split('.')[0];
    if (this.hasModulo(modulo)) return 'operar'; // compat: módulo padre = operar
    return this.permisosMerged()[key] ?? null;
  }
  puedeVerSubmodulo(key: string): boolean {
    return this.nivelSubmodulo(key) !== null;
  }
  puedeOperarSubmodulo(key: string): boolean {
    return this.nivelSubmodulo(key) === 'operar';
  }

  /**
   * Y11 / AC2 — acceso a las secciones RESTRINGIDAS de "Tecnología" de plataforma
   * (versiones de la app, reportes de errores, monitoreo de infraestructura).
   * Reservado a `admin`, `tecnologia`, `gerencia` y `direccion`. Debe coincidir
   * con la función SQL `sgc.es_tecnologia()` (fuente de verdad en RLS).
   */
  esTecnologia = computed(
    () =>
      this.hasRole('admin') ||
      this.hasRole('tecnologia') ||
      this.hasRole('gerencia') ||
      this.hasRole('direccion'),
  );

  /**
   * AC2 — persona "chofer": el usuario de experiencia reducida que entra por
   * cédula + PIN (rol `chofer_transportista`). El módulo Tecnología es visible
   * para todos EXCEPTO este perfil. Debe coincidir con `sgc.es_chofer()`.
   * Un usuario elevado (admin/tecnología) que además fuera chofer SÍ ve
   * Tecnología, de ahí el `&& !esTecnologia()` en los gates.
   */
  esChofer = computed(() => this.hasRole('chofer_transportista'));

  /**
   * AS7 — quién ve TODAS las requisiciones (bandeja global), no solo las propias.
   * Espejo exacto de la función SQL `sgc.puede_ver_todas_requisiciones()` (fuente
   * de verdad en la RLS de `solicitudes_material`): admin, módulo inventario, o los
   * roles de proyecto. El ingeniero de campo NO entra aquí (ve solo las suyas en
   * "Mis requisiciones"); el chofer, ninguna.
   */
  puedeVerTodasRequisiciones = computed(
    () =>
      this.hasRole('admin') ||
      this.hasModulo('inventario') ||
      ['gerente_produccion', 'gerente_proyectos', 'jefe_ingenieros'].some((r) =>
        this.roles().includes(r),
      ),
  );

  /**
   * Quién puede ver el cuadre de materiales + señales antifraude (límites por
   * fase, consumo). Regla dura: los roles de obra/campo NUNCA lo ven. Se limita a
   * roles financieros/dirección aunque tengan el módulo `proyectos`.
   */
  verCuadre = computed(() => {
    const m = this.modulos();
    return m.includes('compras') || m.includes('direccion') || m.includes('admin');
  });

  /** Public avatar URL for the current user, or null if none uploaded. */
  avatarUrl = computed(() => {
    const path = this._profile()?.avatar_path;
    if (!path) return null;
    return this.supabase.client.storage.from('sgc-avatars').getPublicUrl(path).data.publicUrl;
  });

  async loadProfile(userId: string): Promise<void> {
    const { data, error } = await this.supabase.client
      .from('usuarios')
      .select('*, roles:usuarios_roles!usuario_id(rol:roles(codigo, nombre, modulos, permisos))')
      .eq('id', userId)
      .single();

    if (error) {
      console.error('UserService.loadProfile error:', error.message);
      this._profile.set(null);
      return;
    }

    this._profile.set(data as Usuario);
    this.loadedAt = Date.now();
  }

  /** Reloads the profile if missing or older than PROFILE_MAX_AGE_MS, so a role/activo change made elsewhere takes effect without forcing a manual logout. */
  async ensureFreshProfile(userId: string): Promise<void> {
    const stale = this.loadedAt === null || Date.now() - this.loadedAt > PROFILE_MAX_AGE_MS;
    if (!this._profile() || stale) {
      await this.loadProfile(userId);
    }
  }

  clearProfile(): void {
    this._profile.set(null);
    this.loadedAt = null;
  }

  /** Uploads a new avatar for the current user and refreshes the profile.
   *  Name/email are NOT touched here — those stay admin-managed. */
  async uploadAvatar(file: File): Promise<void> {
    const userId = this._profile()?.id;
    if (!userId) throw new Error('Sesión inválida.');

    const ext = (file.name.split('.').pop() || 'png').toLowerCase();
    // Random filename → never collides, so a plain insert (no upsert) is correct.
    // Upsert would take the INSERT-ON-CONFLICT path, which the storage RLS
    // rejects ("new row violates row-level security policy").
    const path = `${userId}/${crypto.randomUUID()}.${ext}`;
    const { error: upErr } = await this.supabase.client.storage
      .from('sgc-avatars')
      .upload(path, file);
    if (upErr) throw new Error(upErr.message);

    const { error: rpcErr } = await this.supabase.client.rpc('actualizar_mi_avatar', { p_path: path });
    if (rpcErr) throw new Error(rpcErr.message);

    await this.loadProfile(userId);
  }
}
