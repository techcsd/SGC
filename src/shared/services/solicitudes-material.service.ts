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

  /** Atomic: creates the real salida (with server-side stock validation) and marks the solicitud entregada, in one transaction. */
  async aprobar(
    id: string,
    payload: {
      bodega_id: string;
      fecha: string;
      responsable: string | null;
      observaciones: string | null;
      items: { articulo_id: string; cantidad: number }[];
    },
  ): Promise<string> {
    const { data: salidaId, error } = await this.supabase.client.rpc('aprobar_solicitud_material', {
      p_solicitud_id: id,
      p_bodega_id: payload.bodega_id,
      p_fecha: payload.fecha,
      p_responsable: payload.responsable,
      p_observaciones: payload.observaciones,
      p_items: payload.items,
    });

    if (error) throw new Error(error.message);
    return salidaId as string;
  }

  async rechazar(id: string, notas?: string | null): Promise<void> {
    const { error } = await this.supabase.client.rpc('rechazar_solicitud_material', {
      p_solicitud_id: id,
      p_notas: notas ?? null,
    });

    if (error) throw new Error(error.message);
  }
}
