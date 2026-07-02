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
    // Atomic delete+insert via RPC — a failed insert must not leave the user with zero roles
    const { error } = await this.supabase.client.rpc('assign_roles', {
      p_usuario_id: usuarioId,
      p_rol_ids: rolIds,
      p_asignado_por: asignadoPor,
    });

    if (error) throw new Error(error.message);
  }
}
