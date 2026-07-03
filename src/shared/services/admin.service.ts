import { Injectable, inject } from '@angular/core';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { SupabaseService } from '../../app/core/services/supabase.service';
import { Usuario, Rol } from '../models/usuario.model';

export interface UsuarioAdmin extends Usuario {
  roles: { rol: Rol }[];
}

/** Edge Functions return {error: "..."} in the body on failure, but functions.invoke()
 *  only gives a generic FunctionsHttpError — this pulls the real message back out. */
async function edgeFunctionErrorMessage(error: unknown): Promise<string> {
  if (error instanceof FunctionsHttpError) {
    try {
      const body = await error.context.json();
      if (body?.error) return body.error as string;
    } catch {
      // fall through to the generic message below
    }
  }
  return error instanceof Error ? error.message : 'Error inesperado.';
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

  /** Nombre only — activo changes always go through toggleActivo() so the Auth-level ban stays in sync. */
  async updateUsuario(id: string, nombre: string): Promise<void> {
    const { error } = await this.supabase.client.rpc('actualizar_usuario', { p_id: id, p_nombre: nombre });
    if (error) throw new Error(error.message);
  }

  /** Deactivating also bans the user at the Auth layer (Edge Function) — not just a DB flag. */
  async toggleActivo(id: string, activo: boolean): Promise<void> {
    const { data, error } = await this.supabase.client.functions.invoke('admin-deactivate-user', {
      body: { userId: id, activo },
    });
    if (error) throw new Error(await edgeFunctionErrorMessage(error));
    if (data?.error) throw new Error(data.error);
  }

  /** Invite-flow: the user sets their own password via an emailed link. Rolls back on partial failure. */
  async createUsuario(payload: { email: string; fullName: string; roleId: number | null }): Promise<void> {
    const { data, error } = await this.supabase.client.functions.invoke('admin-create-user', {
      body: {
        email: payload.email,
        fullName: payload.fullName,
        roleId: payload.roleId,
        // The browser knows its own real domain (dev, Vercel, or a future
        // custom domain) — passing it avoids hardcoding a URL server-side,
        // which is what previously made every invite link point at localhost.
        redirectTo: `${window.location.origin}/auth/set-password`,
      },
    });
    if (error) throw new Error(await edgeFunctionErrorMessage(error));
    if (data?.error) throw new Error(data.error);
  }

  /** Sends a password-reset email; never exposes the password to the admin. */
  async resetPassword(id: string): Promise<{ sent: boolean; actionLink?: string }> {
    const { data, error } = await this.supabase.client.functions.invoke('admin-reset-user-password', {
      body: { userId: id, redirectTo: `${window.location.origin}/auth/set-password` },
    });
    if (error) throw new Error(await edgeFunctionErrorMessage(error));
    if (data?.error) throw new Error(data.error);
    return data as { sent: boolean; actionLink?: string };
  }

  /** Only succeeds for a user with zero associated records anywhere (Postgres enforces this, not app code). */
  async deleteUsuario(id: string): Promise<void> {
    const { data, error } = await this.supabase.client.functions.invoke('admin-delete-user', {
      body: { userId: id },
    });
    if (error) throw new Error(await edgeFunctionErrorMessage(error));
    if (data?.error) throw new Error(data.error);
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
