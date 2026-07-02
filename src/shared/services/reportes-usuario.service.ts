import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';
import { ReporteUsuario, ReporteEstado, ReporteTipo } from '../models/reporte-usuario.model';

// usuarios is joined twice (usuario_id, asignado_a) — must be disambiguated
// with !fkey_name or PostgREST rejects the embed as ambiguous.
const SELECT_QUERY =
  '*, usuario:usuarios!reportes_usuario_usuario_id_fkey(nombre, email), asignado:usuarios!reportes_usuario_asignado_a_fkey(nombre)';

@Injectable({ providedIn: 'root' })
export class ReportesUsuarioService {
  private supabase = inject(SupabaseService);

  /** RLS scopes this: regular users see only their own reports. */
  async getMisReportes(): Promise<ReporteUsuario[]> {
    const { data, error } = await this.supabase.client
      .from('reportes_usuario')
      .select(SELECT_QUERY)
      .order('created_at', { ascending: false });

    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as ReporteUsuario[];
  }

  /** Admin-only in practice (RLS): every report, for the management view. */
  async getAll(): Promise<ReporteUsuario[]> {
    const { data, error } = await this.supabase.client
      .from('reportes_usuario')
      .select(SELECT_QUERY)
      .order('created_at', { ascending: false });

    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as ReporteUsuario[];
  }

  async crear(payload: { usuario_id: string; tipo: ReporteTipo; asunto: string; descripcion: string }): Promise<ReporteUsuario> {
    const { data, error } = await this.supabase.client
      .from('reportes_usuario')
      .insert(payload)
      .select(SELECT_QUERY)
      .single();

    if (error) throw new Error(error.message);
    return data as unknown as ReporteUsuario;
  }

  /** Marks a report as "being worked on" by the given admin. */
  async tomar(id: string, adminId: string): Promise<void> {
    const { error } = await this.supabase.client
      .from('reportes_usuario')
      .update({ estado: 'en_progreso', asignado_a: adminId, updated_at: new Date().toISOString() })
      .eq('id', id);

    if (error) throw new Error(error.message);
  }

  async actualizarEstado(
    id: string,
    payload: { estado: ReporteEstado; respuesta_admin?: string | null },
  ): Promise<void> {
    const isClosing = payload.estado === 'resuelto' || payload.estado === 'descartado';
    const { error } = await this.supabase.client
      .from('reportes_usuario')
      .update({
        estado: payload.estado,
        respuesta_admin: payload.respuesta_admin ?? null,
        updated_at: new Date().toISOString(),
        resuelto_en: isClosing ? new Date().toISOString() : null,
      })
      .eq('id', id);

    if (error) throw new Error(error.message);
  }
}
