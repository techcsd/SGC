import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';
import { SolicitudCompra, SolicitudCompraFormData } from '../models/solicitud.model';
import { notificarSolicitud } from '../utils/notificar-solicitud.util';

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
    notificarSolicitud(this.supabase.client, 'compra', id as string, 'creada');
    return data as unknown as SolicitudCompra;
  }

  /** Atomic: creates the real orden de compra and marks the solicitud convertida, in one transaction. */
  async aprobar(
    id: string,
    payload: {
      proveedor_id: string;
      fecha: string;
      fecha_entrega_esperada: string | null;
      subtotal: number;
      impuesto: number;
      total: number;
      notas: string | null;
      items: { articulo_id: string | null; descripcion: string; cantidad: number; precio_unitario: number; total: number }[];
    },
  ): Promise<string> {
    const { data: ordenId, error } = await this.supabase.client.rpc('aprobar_solicitud_compra', {
      p_solicitud_id: id,
      p_proveedor_id: payload.proveedor_id,
      p_fecha: payload.fecha,
      p_fecha_entrega_esperada: payload.fecha_entrega_esperada,
      p_subtotal: payload.subtotal,
      p_impuesto: payload.impuesto,
      p_total: payload.total,
      p_notas: payload.notas,
      p_items: payload.items,
    });

    if (error) throw new Error(error.message);
    notificarSolicitud(this.supabase.client, 'compra', id, 'aprobada');
    return ordenId as string;
  }

  async rechazar(id: string, notas?: string | null): Promise<void> {
    const { error } = await this.supabase.client.rpc('rechazar_solicitud_compra', {
      p_solicitud_id: id,
      p_notas: notas ?? null,
    });

    if (error) throw new Error(error.message);
    notificarSolicitud(this.supabase.client, 'compra', id, 'rechazada');
  }
}
