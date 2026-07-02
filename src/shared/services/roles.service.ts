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

export const MODULOS_DISPONIBLES = [
  { key: 'inventario', label: 'Inventario' },
  { key: 'compras', label: 'Compras' },
  { key: 'rrhh', label: 'RRHH' },
  { key: 'proyectos', label: 'Proyectos' },
  { key: 'flota', label: 'Flota' },
  { key: 'bitacora', label: 'Bitácora' },
  { key: 'documentos', label: 'Documentos' },
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
}
