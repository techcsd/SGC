import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';

export interface Rol {
  id: number;
  codigo: string;
  nombre: string;
  modulos: string[];
  descripcion?: string;
}

export interface RolUpdatePayload {
  nombre: string;
  modulos: string[];
  descripcion?: string;
}

export interface RolCreatePayload {
  nombre: string;
  modulos: string[];
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
  { key: 'flota', label: 'Flota', desc: 'Vehículos, conductores, pre-uso, reporte semanal, combustible, mantenimientos, rutas y avisos de flota.' },
  { key: 'bitacora', label: 'Bitácora', desc: 'Parte diario de obra, visitas e incidentes: crear y consultar bitácoras.' },
  { key: 'documentos', label: 'Documentos', desc: 'Rellenar y descargar documentos a partir de plantillas.' },
  { key: 'plantillas', label: 'Plantillas (crear/editar)', desc: 'Crear y editar las plantillas de documentos, no solo usarlas.' },
  { key: 'legal', label: 'Legal', desc: 'Expedientes legales, contratos y aprobaciones (rol jurídico).' },
  { key: 'tareas', label: 'Tareas (asignar)', desc: 'Asignar y dar seguimiento a tareas de otros. Todo usuario ya tiene "Mis tareas" sin este módulo.' },
  { key: 'tecnologia', label: 'Tecnología', desc: 'Inventario tecnológico, equipos y herramientas de TI y matriz tecnológica.' },
  { key: 'direccion', label: 'Dirección (vista ejecutiva)', desc: 'Vista ejecutiva: KPIs y dashboards consolidados de dirección.', sensible: true },
  { key: 'admin', label: 'Administración', desc: 'Usuarios, roles y permisos, versiones de la app, auditoría y reportes. Acceso máximo — asignar con cuidado.', sensible: true },
];

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
