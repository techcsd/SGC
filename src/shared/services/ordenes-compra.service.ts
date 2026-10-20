import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';
import { OrdenCompra, OrdenCompraItem, OrdenEstado } from '../models/orden-compra.model';

export interface OrdenCompraPayload {
  proveedor_id: string;
  proyecto_id?: string | null;
  estado: OrdenEstado;
  fecha: string;
  fecha_entrega_esperada?: string | null;
  subtotal: number;
  impuesto: number;
  total: number;
  notas?: string | null;
  // Z6
  destino?: 'proyecto' | 'oficina';
  aplica_impuesto?: boolean;
  es_prueba?: boolean;
}

@Injectable({ providedIn: 'root' })
export class OrdenesCompraService {
  private supabase = inject(SupabaseService);

  async getAll(): Promise<OrdenCompra[]> {
    const { data, error } = await this.supabase.client
      .schema('sgc')
      .from('ordenes_compra')
      .select('*, proveedor:proveedores(nombre), proyecto:proyectos(nombre)')
      .order('created_at', { ascending: false });

    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as OrdenCompra[];
  }

  async getById(id: string): Promise<OrdenCompra> {
    const { data, error } = await this.supabase.client
      .schema('sgc')
      .from('ordenes_compra')
      .select('*, proveedor:proveedores(nombre), proyecto:proyectos(nombre), items:orden_compra_items(*)')
      .eq('id', id)
      .single();

    if (error) throw new Error(error.message);
    return data as unknown as OrdenCompra;
  }

  async create(
    orden: OrdenCompraPayload,
    items: Omit<OrdenCompraItem, 'id' | 'orden_id'>[],
    creadoPor: string | null,
  ): Promise<OrdenCompra> {
    const { data: ordenId, error } = await this.supabase.client.rpc('crear_orden_compra', {
      p_proveedor_id: orden.proveedor_id,
      p_proyecto_id: orden.proyecto_id ?? null,
      p_estado: orden.estado,
      p_fecha: orden.fecha,
      p_fecha_entrega_esperada: orden.fecha_entrega_esperada ?? null,
      p_subtotal: orden.subtotal,
      p_impuesto: orden.impuesto,
      p_total: orden.total,
      p_notas: orden.notas ?? null,
      p_creado_por: creadoPor,
      p_items: items,
      p_destino: orden.destino ?? 'proyecto',
      p_aplica_impuesto: orden.aplica_impuesto ?? true,
      p_es_prueba: orden.es_prueba ?? false,
    });

    if (error) throw new Error(error.message);
    return this.getById(ordenId as string);
  }

  /** Transition validity (borrador -> aprobada|cancelada, aprobada -> recibida|cancelada) is enforced server-side.
   *  CT3c — pasar a "recibida" con reconciliación incompleta exige `motivo` (solo admin; el servidor lo valida igual). */
  async updateEstado(id: string, estado: OrdenEstado, motivo?: string | null): Promise<void> {
    const { error } = await this.supabase.client
      .schema('sgc')
      .rpc('actualizar_estado_orden', { p_orden_id: id, p_nuevo_estado: estado, p_motivo: motivo ?? null });

    if (error) throw new Error(error.message);
  }

  /**
   * QA-076b — vincula un renglón capturado a mano (articulo_id null, p.ej. una OC
   * nacida de una requisición con texto libre) a un artículo del catálogo. Sin esto
   * el renglón nunca entra al select de Inventario > Entradas (solo lista catálogo)
   * y la orden queda permanentemente "sin forma de recibirse" (reporte de Raykler,
   * OC-202610-0006 — "BOTA DE GOMA # 44/45" nunca tuvieron artículo). Update directo:
   * la RLS de orden_compra_items ya permite UPDATE a tiene_modulo('compras').
   */
  async vincularArticulo(itemId: string, articuloId: string): Promise<void> {
    const { error } = await this.supabase.client
      .schema('sgc')
      .from('orden_compra_items')
      .update({ articulo_id: articuloId })
      .eq('id', itemId);

    if (error) throw new Error(error.message);
  }
}
