import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';

/** AG12 — nivel de permiso por submódulo. */
export type NivelPermiso = 'ver' | 'operar';
/** Mapa "modulo.submodulo" → nivel. */
export type PermisosMap = Record<string, NivelPermiso>;

export interface Rol {
  id: number;
  codigo: string;
  nombre: string;
  modulos: string[];
  // AG12 — permisos granulares por submódulo (aditivo; null/{} = solo módulos).
  permisos?: PermisosMap | null;
  descripcion?: string;
  // AO6 — el rol comparte ubicación por defecto (choferes/transportistas).
  comparte_ubicacion?: boolean;
}

export interface RolUpdatePayload {
  nombre: string;
  modulos: string[];
  permisos?: PermisosMap;
  descripcion?: string;
  comparte_ubicacion?: boolean;
}

export interface RolCreatePayload {
  nombre: string;
  modulos: string[];
  permisos?: PermisosMap;
  descripcion?: string;
  comparte_ubicacion?: boolean;
}

/**
 * AN4 — accesos efectivos (unión de roles). `submodulos` solo lista los grants
 * granulares EXPLÍCITOS más allá de los módulos completos.
 */
export interface AccesosEfectivos {
  modulos: string[];
  submodulos: PermisosMap;
}

/** AN4 — usuarios con 2+ roles (candidatos a limpieza de la auditoría). */
export interface UsuarioMultiRol {
  usuario_id: string;
  nombre: string;
  email: string;
  n_roles: number;
  roles: { id: number; codigo: string; nombre: string }[];
  modulos: string[];
}

/**
 * Módulos de permiso. `desc` explica QUÉ desbloquea cada módulo para que el
 * admin sepa exactamente qué acceso concede al marcarlo. `sensible` resalta los
 * módulos de acceso amplio/administrativo que conviene asignar con cuidado.
 */
export interface ModuloInfo {
  key: string;
  label: string;
  desc: string;
  sensible?: boolean;
}

export const MODULOS_DISPONIBLES: ModuloInfo[] = [
  { key: 'inventario', label: 'Inventario', desc: 'Almacenes, artículos, entradas/salidas, conduces, conteos y requisiciones. Ver y mover stock.' },
  { key: 'compras', label: 'Compras', desc: 'Solicitudes y órdenes de compra a proveedores; aprobar y recibir compras.' },
  { key: 'rrhh', label: 'RRHH', desc: 'Empleados, asistencia, ausencias/vacaciones y documentos de personal.' },
  { key: 'proyectos', label: 'Proyectos', desc: 'Obras y proyectos, partidas planeadas, avance, pagado vs trabajado y ranking de encargados.' },
  { key: 'flota', label: 'Flota', desc: 'Vehículos, conductores, uso de vehículo, inspección vehículo, combustible, mantenimientos, rutas y avisos de flota.' },
  { key: 'transporte', label: 'Transporte (chofer)', desc: 'Funciones de logística del chofer: rutas por tipo (material/personal/traslado), conduces recibidos y compras/recepciones de ferretería que Almacén confirma. Alcance limitado, sin el módulo Inventario completo.' },
  { key: 'bitacora', label: 'Bitácora', desc: 'Bitácora del día de obra, visitas e incidentes: crear y consultar bitácoras.' },
  { key: 'documentos', label: 'Documentos', desc: 'Rellenar y descargar documentos a partir de plantillas.' },
  { key: 'plantillas', label: 'Plantillas (crear/editar)', desc: 'Crear y editar las plantillas de documentos, no solo usarlas.' },
  { key: 'legal', label: 'Legal', desc: 'Expedientes legales, contratos y aprobaciones (rol jurídico).' },
  { key: 'tareas', label: 'Tareas (asignar)', desc: 'Asignar y dar seguimiento a tareas de otros. Todo usuario ya tiene "Mis tareas" sin este módulo.' },
  { key: 'obra', label: 'Producción de Obra', desc: 'Gestión de producción en obra: plan del día y charla de seguridad, no conformidades e incidentes, checklists de calidad, subcontratistas y cubicaciones, avance real e informe semanal. Rol gerente de producción / capataz.' },
  { key: 'tecnologia', label: 'Tecnología', desc: 'Activos de TI: inventario tecnológico (equipos, tipos, ubicación, fotos), guía de herramientas, homologación, matriz puesto × herramienta y compras tecnológicas. La consola de plataforma "Sistema" (versiones, QA, monitoreo, errores) es aparte y depende del rol Tecnología.' },
  { key: 'direccion', label: 'Dirección (vista ejecutiva)', desc: 'Vista ejecutiva: KPIs y dashboards consolidados de dirección.', sensible: true },
  { key: 'plataforma', label: 'Plataforma (app)', desc: 'Personalización de la app: orden y tamaño de los módulos del launcher. Permiso delegable, no requiere ser administrador.' },
  { key: 'admin', label: 'Administración', desc: 'Usuarios, roles y permisos, versiones de la app, auditoría y reportes. Acceso máximo — asignar con cuidado.', sensible: true },
];

/**
 * AG12 — catálogo de submódulos por módulo, para la matriz de permisos granulares.
 * `enforced` marca los que ya se gatean end-to-end por submódulo (menú + ruta + RLS).
 * El resto se guarda y quedará gateado a medida que se extienda el modelo; el
 * checkbox del módulo padre sigue dando 'operar' sobre todos sus submódulos.
 */
export interface SubmoduloInfo {
  key: string;
  label: string;
  enforced?: boolean;
}
export const SUBMODULOS: Record<string, SubmoduloInfo[]> = {
  // AW5 — Bitácora. `ver_todas` es una CAPACIDAD de supervisión (no una pantalla):
  // concede ver las bitácoras de TODOS los ingenieros (no solo las propias).
  // Gateado end-to-end (RLS + RPC). Lista de roles EDITABLE desde aquí sin deploy.
  bitacora: [
    { key: 'bitacora.ver_todas', label: 'Ver todas las bitácoras (supervisión)', enforced: true },
  ],
  // AN2 — Inventario, Flota y Compras: submódulos gateados end-to-end
  // (menú + ruta + RLS). Ver = leer; Operar = crear/editar/eliminar.
  compras: [
    { key: 'compras.proveedores', label: 'Proveedores', enforced: true },
    { key: 'compras.ordenes', label: 'Órdenes de compra', enforced: true },
    { key: 'compras.solicitudes', label: 'Solicitudes de compra', enforced: true },
  ],
  inventario: [
    { key: 'inventario.entradas', label: 'Entradas', enforced: true },
    { key: 'inventario.salidas', label: 'Salidas / Conduces', enforced: true },
    { key: 'inventario.articulos', label: 'Artículos', enforced: true },
    { key: 'inventario.conteos', label: 'Conteos', enforced: true },
  ],
  flota: [
    { key: 'flota.vehiculos', label: 'Vehículos', enforced: true },
    // Conductores: RLS por submódulo; las PANTALLAS de gestión siguen restringidas
    // a roles de flota elevados (no se relajan en esta tanda).
    { key: 'flota.conductores', label: 'Conductores', enforced: true },
    { key: 'flota.combustible', label: 'Combustible', enforced: true },
    { key: 'flota.mantenimientos', label: 'Mantenimientos', enforced: true },
    { key: 'flota.rutas', label: 'Rutas / Seguimiento', enforced: true },
  ],
  rrhh: [
    { key: 'rrhh.empleados', label: 'Empleados' },
    { key: 'rrhh.asistencia', label: 'Asistencia' },
    { key: 'rrhh.ausencias', label: 'Ausencias / Vacaciones' },
  ],
  // AR1 — gateados end-to-end (menú + ruta + RLS por obra).
  proyectos: [
    { key: 'proyectos.obras', label: 'Obras', enforced: true },
    { key: 'proyectos.cronograma', label: 'Cronograma', enforced: true },
    { key: 'proyectos.ranking', label: 'Ranking de encargados', enforced: true },
    { key: 'proyectos.personal', label: 'Personal de obra', enforced: true },
  ],
  // AG16 — Gestión de Producción de Obra. `obra.no_conformidades` ya se gatea
  // end-to-end (menú + ruta + RLS); el resto se irá gateando por fase.
  obra: [
    { key: 'obra.plan_dia', label: 'Plan del día y charla de seguridad' },
    { key: 'obra.no_conformidades', label: 'No conformidades e incidentes', enforced: true },
    { key: 'obra.checklists', label: 'Checklists de calidad' },
    { key: 'obra.subcontratistas', label: 'Subcontratistas y cubicaciones' },
    { key: 'obra.avance', label: 'Avance, costos y logística' },
    { key: 'obra.informes', label: 'Informe semanal' },
  ],
  // AJ4 — permiso delegable para personalizar el layout de la app (launcher).
  // Gateado server-side en set_module_order (is_admin OR puede_operar_submodulo).
  plataforma: [
    { key: 'plataforma.layout_app', label: 'Personalizar layout de la app', enforced: true },
  ],
};

@Injectable({ providedIn: 'root' })
export class RolesService {
  private supabase = inject(SupabaseService);

  async getAll(): Promise<Rol[]> {
    const { data, error } = await this.supabase.client
      .from('roles')
      .select('*')
      .order('nombre');

    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as Rol[];
  }

  async update(id: number, payload: RolUpdatePayload): Promise<void> {
    const { error } = await this.supabase.client
      .from('roles')
      .update({
        nombre: payload.nombre,
        modulos: payload.modulos,
        permisos: payload.permisos ?? {},
        descripcion: payload.descripcion ?? null,
        comparte_ubicacion: payload.comparte_ubicacion ?? false,
      })
      .eq('id', id);

    if (error) throw new Error(error.message);
  }

  async create(payload: RolCreatePayload): Promise<Rol> {
    const codigo = payload.nombre
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '') // strip accents (combining diacritical marks)
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');

    const { data, error } = await this.supabase.client
      .from('roles')
      .insert({
        codigo,
        nombre: payload.nombre,
        modulos: payload.modulos,
        permisos: payload.permisos ?? {},
        descripcion: payload.descripcion?.trim() || null,
        comparte_ubicacion: payload.comparte_ubicacion ?? false,
      })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        throw new Error('Ya existe un rol con un nombre muy similar. Usa un nombre distinto.');
      }
      throw new Error(error.message);
    }
    return data as unknown as Rol;
  }

  /** Guarded server-side: refuses to delete the admin role or a role currently assigned to users. */
  async delete(id: number): Promise<void> {
    const { error } = await this.supabase.client.rpc('eliminar_rol', { p_rol_id: id });
    if (error) throw new Error(error.message);
  }

  // ── AN4 — auditoría de accesos (todos admin-only server-side) ──────────

  private normalizarAccesos(data: unknown): AccesosEfectivos {
    const d = (data ?? {}) as { modulos?: unknown; submodulos?: unknown };
    return {
      modulos: Array.isArray(d.modulos) ? (d.modulos as string[]) : [],
      submodulos: (d.submodulos && typeof d.submodulos === 'object'
        ? (d.submodulos as PermisosMap)
        : {}),
    };
  }

  /** Accesos efectivos (módulos + submódulos explícitos) de un rol. */
  async accesosEfectivosRol(rolId: number): Promise<AccesosEfectivos> {
    const { data, error } = await this.supabase.client.rpc('accesos_efectivos_rol', {
      p_rol_id: rolId,
    });
    if (error) throw new Error(error.message);
    return this.normalizarAccesos(data);
  }

  /** Accesos efectivos de un usuario (unión de todos sus roles). */
  async accesosEfectivosUsuario(usuarioId: string): Promise<AccesosEfectivos> {
    const { data, error } = await this.supabase.client.rpc('accesos_efectivos_usuario', {
      p_usuario_id: usuarioId,
    });
    if (error) throw new Error(error.message);
    return this.normalizarAccesos(data);
  }

  /** Accesos efectivos de un conjunto arbitrario de roles (para diffs antes/después). */
  async accesosEfectivosDeRoles(rolIds: number[]): Promise<AccesosEfectivos> {
    if (rolIds.length === 0) return { modulos: [], submodulos: {} };
    const { data, error } = await this.supabase.client.rpc('accesos_efectivos_de_roles', {
      p_rol_ids: rolIds,
    });
    if (error) throw new Error(error.message);
    return this.normalizarAccesos(data);
  }

  /** Usuarios con 2+ roles — candidatos a limpieza ("un usuario = un rol"). */
  async usuariosMultiRol(): Promise<UsuarioMultiRol[]> {
    const { data, error } = await this.supabase.client.rpc('usuarios_multi_rol');
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as UsuarioMultiRol[];
  }
}
