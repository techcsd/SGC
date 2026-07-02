import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';
import { SolicitudCompra, SolicitudCompraFormData } from '../models/solicitud.model';

// usuarios is joined twice (solicitante_id, atendido_por) — the relationship must be
// disambiguated with !fkey_name or PostgREST rejects the embed as ambiguous.
const SELECT_QUERY =
  '*, proyecto:proyectos(nombre), solicitante:usuarios!solicitudes_compra_solicitante_id_fkey(nombre), items:solicitud_compra_items(*)';

@Injectable({ providedIn: 'root' })
export class SolicitudesCompraService {
  private supabase = inject(SupabaseService);

  /** RLS scopes this: engineers see their own, Compras staff/admin see all. */
  async getAll(): Promise<SolicitudCompra[]> {
    const { data, error } = await this.supabase.client
      .from('solicitudes_compra')
      .select(SELECT_QUERY)
      .order('created_at', { ascending: false });

    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as SolicitudCompra[];
  }

  async create(payload: SolicitudCompraFormData): Promise<SolicitudCompra> {
    const { data: id, error } = await this.supabase.client.rpc('crear_solicitud_compra', {
      p_proyecto_id: payload.proyecto_id,
      p_solicitante_id: payload.solicitante_id,
      p_notas: payload.notas,
      p_items: payload.items,
    });

    if (error) throw new Error(error.message);

    const { data, error: fetchError } = await this.supabase.client
      .from('solicitudes_compra')
      .select(SELECT_QUERY)
      .eq('id', id as string)
      .single();

    if (fetchError) throw new Error(fetchError.message);
    return data as unknown as SolicitudCompra;
  }

  async marcarAtendida(
    id: string,
    payload: { estado: 'convertida' | 'rechazada'; orden_compra_id?: string | null; atendidoPor: string },
  ): Promise<void> {
    const { error } = await this.supabase.client
      .from('solicitudes_compra')
      .update({
        estado: payload.estado,
        orden_compra_id: payload.orden_compra_id ?? null,
        atendido_por: payload.atendidoPor,
        atendido_en: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);

    if (error) throw new Error(error.message);
  }
}
