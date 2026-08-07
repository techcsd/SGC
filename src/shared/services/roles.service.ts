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
}

export interface RolUpdatePayload {
  nombre: string;
  modulos: string[];
  permisos?: PermisosMap;
  descripcion?: string;
}

export interface RolCreatePayload {
  nombre: string;
  modulos: string[];
  permisos?: PermisosMap;
  descripcion?: string;
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
  { key: 'tecnologia', label: 'Tecnología', desc: 'Inventario tecnológico, equipos y herramientas de TI y matriz tecnológica.' },
  { key: 'direccion', label: 'Dirección (vista ejecutiva)', desc: 'Vista ejecutiva: KPIs y dashboards consolidados de dirección.', sensible: true },
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
  compras: [
    { key: 'compras.proveedores', label: 'Proveedores', enforced: true },
    { key: 'compras.ordenes', label: 'Órdenes de compra' },
    { key: 'compras.solicitudes', label: 'Solicitudes de compra' },
  ],
  inventario: [
    { key: 'inventario.entradas', label: 'Entradas' },
    { key: 'inventario.salidas', label: 'Salidas / Conduces' },
    { key: 'inventario.articulos', label: 'Artículos' },
    { key: 'inventario.conteos', label: 'Conteos' },
  ],
  flota: [
    { key: 'flota.vehiculos', label: 'Vehículos' },
    { key: 'flota.conductores', label: 'Conductores' },
    { key: 'flota.combustible', label: 'Combustible' },
    { key: 'flota.mantenimientos', label: 'Mantenimientos' },
    { key: 'flota.rutas', label: 'Rutas / Seguimiento' },
  ],
  rrhh: [
    { key: 'rrhh.empleados', label: 'Empleados' },
    { key: 'rrhh.asistencia', label: 'Asistencia' },
    { key: 'rrhh.ausencias', label: 'Ausencias / Vacaciones' },
  ],
  proyectos: [
    { key: 'proyectos.obras', label: 'Obras' },
    { key: 'proyectos.cronograma', label: 'Cronograma' },
    { key: 'proyectos.ranking', label: 'Ranking de encargados' },
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
}
