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
}

export interface RolCreatePayload {
  nombre: string;
  modulos: string[];
}

export const MODULOS_DISPONIBLES = [
  { key: 'inventario', label: 'Inventario' },
  { key: 'compras', label: 'Compras' },
  { key: 'rrhh', label: 'RRHH' },
  { key: 'proyectos', label: 'Proyectos' },
  { key: 'flota', label: 'Flota' },
  { key: 'bitacora', label: 'Bitácora' },
  { key: 'documentos', label: 'Documentos' },
  { key: 'plantillas', label: 'Plantillas (crear/editar)' },
  { key: 'legal', label: 'Legal' },
  { key: 'tareas', label: 'Tareas (asignar)' },
  { key: 'tecnologia', label: 'Tecnología' },
  { key: 'direccion', label: 'Dirección (vista ejecutiva)' },
  { key: 'admin', label: 'Administración' },
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
      .update({ nombre: payload.nombre, modulos: payload.modulos })
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
      .insert({ codigo, nombre: payload.nombre, modulos: payload.modulos })
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
