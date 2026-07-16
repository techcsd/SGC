import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';
import { ReporteUsuario, ReporteEstado, ReporteTipo } from '../models/reporte-usuario.model';

// usuarios is joined twice (usuario_id, asignado_a) — must be disambiguated
// with !fkey_name or PostgREST rejects the embed as ambiguous.
const SELECT_QUERY =
  '*, usuario:usuarios!reportes_usuario_usuario_id_fkey(nombre, email), asignado:usuarios!reportes_usuario_asignado_a_fkey(nombre), fotos:reportes_usuario_fotos(*)';

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

  /** Signed URL for a report photo (private `reportes` bucket). */
  async getSignedUrl(path: string): Promise<string> {
    const { data, error } = await this.supabase.client.storage
      .from('reportes')
      .createSignedUrl(path, 3600);
    if (error) throw new Error(error.message);
    return data.signedUrl;
  }

  async crear(
    payload: { usuario_id: string; tipo: ReporteTipo; asunto: string; descripcion: string },
    fotos: File[] = [],
  ): Promise<ReporteUsuario> {
    // Con fotos: mismo flujo que la app (crear_reporte_app inserta reporte + fotos
    // vía SECURITY DEFINER). Sin fotos: insert directo (RLS permite el propio).
    if (fotos.length > 0) {
      const id = crypto.randomUUID();
      const fotoPaths: { storage_path: string }[] = [];
      for (const file of fotos) {
        const path = `${payload.usuario_id}/${id}/${crypto.randomUUID()}.jpg`;
        const { error: upErr } = await this.supabase.client.storage.from('reportes').upload(path, file);
        if (upErr) throw new Error(upErr.message);
        fotoPaths.push({ storage_path: path });
      }
      const { error: rpcErr } = await this.supabase.client.rpc('crear_reporte_app', {
        p_id: id,
        p_tipo: payload.tipo,
        p_asunto: payload.asunto,
        p_descripcion: payload.descripcion,
        p_fotos: fotoPaths,
      });
      if (rpcErr) throw new Error(rpcErr.message);
      const { data, error } = await this.supabase.client
        .from('reportes_usuario')
        .select(SELECT_QUERY)
        .eq('id', id)
        .single();
      if (error) throw new Error(error.message);
      return data as unknown as ReporteUsuario;
    }

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
