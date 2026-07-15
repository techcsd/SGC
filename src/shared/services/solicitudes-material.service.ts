import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';
import {
  SolicitudMaterial,
  SolicitudMaterialFormData,
  AprobacionRequisicionResultado,
} from '../models/solicitud.model';
import { notificarSolicitud } from '../utils/notificar-solicitud.util';
import { NotificacionesService } from './notificaciones.service';

// usuarios is joined twice (solicitante_id, atendido_por) — the relationship must be
// disambiguated with !fkey_name or PostgREST rejects the embed as ambiguous.
const SELECT_QUERY =
  '*, proyecto:proyectos(nombre), solicitante:usuarios!solicitudes_material_solicitante_id_fkey(nombre), items:solicitud_material_items(*)';

@Injectable({ providedIn: 'root' })
export class SolicitudesMaterialService {
  private supabase = inject(SupabaseService);
  private notificaciones = inject(NotificacionesService);

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
    notificarSolicitud(this.supabase.client, 'material', id as string, 'creada');
    this.notificaciones.refresh();
    return data as unknown as SolicitudMaterial;
  }

  /**
   * @deprecated Usa aprobarRequisicion (A2). Se conserva por retro-compatibilidad.
   * Atomic: creates the real salida (full-stock only) and marks the solicitud entregada.
   */
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
    notificarSolicitud(this.supabase.client, 'material', id, 'aprobada');
    this.notificaciones.refresh();
    return salidaId as string;
  }

  /**
   * A2 — Aprobación unificada de la Requisición con auto-división:
   *   parte en stock del almacén -> DESPACHO (salida/conduce);
   *   faltante -> SOLICITUD DE COMPRA automática (bandeja de Compras).
   * Un solo paso atómico. Devuelve el resumen de la división.
   */
  async aprobarRequisicion(
    id: string,
    payload: {
      bodega_id: string;
      fecha: string;
      responsable: string | null;
      observaciones: string | null;
      items: { articulo_id: string | null; descripcion: string; unidad?: string | null; cantidad: number }[];
    },
  ): Promise<AprobacionRequisicionResultado> {
    const { data, error } = await this.supabase.client.rpc('aprobar_requisicion', {
      p_solicitud_id: id,
      p_bodega_id: payload.bodega_id,
      p_fecha: payload.fecha,
      p_responsable: payload.responsable,
      p_observaciones: payload.observaciones,
      p_items: payload.items,
    });

    if (error) throw new Error(error.message);
    notificarSolicitud(this.supabase.client, 'material', id, 'aprobada');
    this.notificaciones.refresh();
    const r = (data ?? {}) as Partial<AprobacionRequisicionResultado>;
    return {
      salida_id: r.salida_id ?? null,
      solicitud_compra_id: r.solicitud_compra_id ?? null,
      despachado_total: Number(r.despachado_total ?? 0),
      faltante_total: Number(r.faltante_total ?? 0),
    };
  }

  /**
   * U25/V14 — registra un valor "Otro" (texto libre) para la inteligencia de
   * otros_valores (sugerir crear el artículo si se repite). No bloquea el flujo.
   */
  registrarOtro(valor: string, referenciaId: string | null): void {
    const v = (valor ?? '').trim();
    if (!v) return;
    this.supabase.client
      .rpc('registrar_otro_valor', {
        p_contexto: 'requisicion_material',
        p_valor: v,
        p_referencia_id: referenciaId,
      })
      .then(({ error }) => {
        if (error) console.error('registrar_otro_valor failed', error.message);
      });
  }

  async rechazar(id: string, notas?: string | null): Promise<void> {
    const { error } = await this.supabase.client.rpc('rechazar_solicitud_material', {
      p_solicitud_id: id,
      p_notas: notas ?? null,
    });

    if (error) throw new Error(error.message);
    notificarSolicitud(this.supabase.client, 'material', id, 'rechazada');
    this.notificaciones.refresh();
  }
}
