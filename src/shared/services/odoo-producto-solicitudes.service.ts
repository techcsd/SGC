import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';
import { OdooProductoSolicitud, OdooProductoSolicitudEstado } from '../models/odoo-producto-solicitud.model';
import { NotificacionesService } from './notificaciones.service';

const SELECT = '*, articulo_resultante:articulos(nombre, codigo), orden:ordenes_compra(numero)';

/**
 * CY24 Fase B — bandeja "Productos por dar de alta en Odoo" (odoo_producto_solicitudes).
 * RLS: el solicitante ve solo lo suyo; Compras/admin ven todas (misma regla que las RPC).
 */
@Injectable({ providedIn: 'root' })
export class OdooProductoSolicitudesService {
  private supabase = inject(SupabaseService);
  private notificaciones = inject(NotificacionesService);

  async listar(): Promise<OdooProductoSolicitud[]> {
    const { data, error } = await this.supabase.client
      .from('odoo_producto_solicitudes')
      .select(SELECT)
      .order('solicitado_en', { ascending: false });
    if (error) throw new Error(error.message);
    const filas = (data ?? []) as unknown as OdooProductoSolicitud[];
    return this.conNombres(filas);
  }

  /** CJ10 — resuelve solicitado_por/resuelto_por → nombre (la FK apunta a auth.users, no a sgc.usuarios). */
  private async conNombres(filas: OdooProductoSolicitud[]): Promise<OdooProductoSolicitud[]> {
    const ids = [...new Set(filas.flatMap((f) => [f.solicitado_por, f.resuelto_por]).filter((v): v is string => !!v))];
    if (ids.length === 0) return filas;
    const { data } = await this.supabase.client.rpc('resolver_nombres_usuarios', { p_ids: ids });
    const nombres = new Map(((data ?? []) as { id: string; nombre: string }[]).map((u) => [u.id, u.nombre]));
    return filas.map((f) => ({
      ...f,
      solicitado_por_nombre: nombres.get(f.solicitado_por) ?? null,
      resuelto_por_nombre: f.resuelto_por ? (nombres.get(f.resuelto_por) ?? null) : null,
    }));
  }

  async crear(descripcionLibre: string, busquedaPrevia: string, ordenId: string | null = null, ordenItemId: string | null = null): Promise<string> {
    const { data, error } = await this.supabase.client.rpc('crear_solicitud_producto_odoo', {
      p_descripcion_libre: descripcionLibre,
      p_busqueda_previa: busquedaPrevia,
      p_orden_id: ordenId,
      p_orden_item_id: ordenItemId,
    });
    if (error) throw new Error(error.message);
    this.notificaciones.refresh();
    return data as string;
  }

  async resolver(solicitudId: string, decision: OdooProductoSolicitudEstado, articuloId: string | null, motivo: string | null): Promise<void> {
    const { data, error } = await this.supabase.client.rpc('resolver_solicitud_producto', {
      p_solicitud_id: solicitudId,
      p_decision: decision,
      p_articulo_id: articuloId,
      p_motivo: motivo,
    });
    if (error) throw new Error(error.message);
    const resultado = data as { ok: boolean; motivo?: string };
    if (!resultado.ok) throw new Error(resultado.motivo ?? 'No se pudo resolver la solicitud.');
    this.notificaciones.refresh();
  }
}
