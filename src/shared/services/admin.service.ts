import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';
import { Usuario, Rol } from '../models/usuario.model';

export interface UsuarioAdmin extends Usuario {
  roles: { rol: Rol }[];
}

export interface UsuarioUpdatePayload {
  nombre: string;
  activo: boolean;
}

@Injectable({ providedIn: 'root' })
export class AdminService {
  private supabase = inject(SupabaseService);

  async getAllUsuarios(): Promise<UsuarioAdmin[]> {
    const { data, error } = await this.supabase.client
      .from('usuarios')
      .select('*, roles:usuarios_roles!usuario_id(rol:roles(id, codigo, nombre, modulos))')
      .order('nombre');

    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as UsuarioAdmin[];
  }

  async getAllRoles(): Promise<Rol[]> {
    const { data, error } = await this.supabase.client
      .from('roles')
      .select('*')
      .order('nombre');

    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as Rol[];
  }

  async updateUsuario(id: string, payload: UsuarioUpdatePayload): Promise<void> {
    const { error } = await this.supabase.client
      .from('usuarios')
      .update({ nombre: payload.nombre, activo: payload.activo })
      .eq('id', id);

    if (error) throw new Error(error.message);
  }

  async toggleActivo(id: string, activo: boolean): Promise<void> {
    const { error } = await this.supabase.client
      .from('usuarios')
      .update({ activo })
      .eq('id', id);

    if (error) throw new Error(error.message);
  }

  async assignRoles(usuarioId: string, rolIds: number[], asignadoPor: string): Promise<void> {
    // Delete all current role assignments for this user
    const { error: delError } = await this.supabase.client
      .from('usuarios_roles')
      .delete()
      .eq('usuario_id', usuarioId);

    if (delError) throw new Error(delError.message);

    if (rolIds.length === 0) return;

    const rows = rolIds.map((rolId) => ({
      usuario_id: usuarioId,
      rol_id: rolId,
      asignado_por: asignadoPor,
    }));

    const { error: insError } = await this.supabase.client
      .from('usuarios_roles')
      .insert(rows);

    if (insError) throw new Error(insError.message);
  }
}
