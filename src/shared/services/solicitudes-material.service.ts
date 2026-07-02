import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';
import { SolicitudMaterial, SolicitudMaterialFormData } from '../models/solicitud.model';

// usuarios is joined twice (solicitante_id, atendido_por) — the relationship must be
// disambiguated with !fkey_name or PostgREST rejects the embed as ambiguous.
const SELECT_QUERY =
  '*, proyecto:proyectos(nombre), solicitante:usuarios!solicitudes_material_solicitante_id_fkey(nombre), items:solicitud_material_items(*)';

@Injectable({ providedIn: 'root' })
export class SolicitudesMaterialService {
  private supabase = inject(SupabaseService);

  /** RLS scopes this: engineers see their own, Inventario staff/admin see all. */
  async getAll(): Promise<SolicitudMaterial[]> {
    const { data, error } = await this.supabase.client
      .from('solicitudes_material')
      .select(SELECT_QUERY)
      .order('created_at', { ascending: false });

    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as SolicitudMaterial[];
  }

  async create(payload: SolicitudMaterialFormData): Promise<SolicitudMaterial> {
    const { data: id, error } = await this.supabase.client.rpc('crear_solicitud_material', {
      p_proyecto_id: payload.proyecto_id,
      p_solicitante_id: payload.solicitante_id,
      p_urgencia: payload.urgencia,
      p_notas: payload.notas,
      p_items: payload.items,
    });

    if (error) throw new Error(error.message);

    const { data, error: fetchError } = await this.supabase.client
      .from('solicitudes_material')
      .select(SELECT_QUERY)
      .eq('id', id as string)
      .single();

    if (fetchError) throw new Error(fetchError.message);
    return data as unknown as SolicitudMaterial;
  }

  async marcarAtendida(
    id: string,
    payload: { estado: 'aprobada' | 'rechazada' | 'entregada'; salida_id?: string | null; atendidoPor: string },
  ): Promise<void> {
    const { error } = await this.supabase.client
      .from('solicitudes_material')
      .update({
        estado: payload.estado,
        salida_id: payload.salida_id ?? null,
        atendido_por: payload.atendidoPor,
        atendido_en: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);

    if (error) throw new Error(error.message);
  }
}
