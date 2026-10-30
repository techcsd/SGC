import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';
import { OrdenCompraItem, OrdenEstado } from '../models/orden-compra.model';
import { OdooOrdenCompra } from '../models/odoo-orden-compra.model';
import { OdooProductoCompra } from '../models/odoo.model';
import { OdooApiService } from './odoo-api.service';

/** Camino Odoo (#24): espejo de OrdenesCompraService para OC publicadas en Odoo. */
export interface OdooOrdenCompraPayload {
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
export class OdooOrdenesCompraService {
  private supabase = inject(SupabaseService);
  private odoo = inject(OdooApiService);

  async getAll(): Promise<OdooOrdenCompra[]> {
    const { data, error } = await this.supabase.client
      .schema('sgc')
      .from('ordenes_compra')
      .select('*, proveedor:proveedores(nombre), proyecto:proyectos(nombre)')
      .order('created_at', { ascending: false });

    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as OdooOrdenCompra[];
  }

  async getById(id: string): Promise<OdooOrdenCompra> {
    const { data, error } = await this.supabase.client
      .schema('sgc')
      .from('ordenes_compra')
      .select('*, proveedor:proveedores(nombre), proyecto:proyectos(nombre), items:orden_compra_items(*)')
      .eq('id', id)
      .single();

    if (error) throw new Error(error.message);
    return data as unknown as OdooOrdenCompra;
  }

  async create(
    orden: OdooOrdenCompraPayload,
    items: Omit<OrdenCompraItem, 'id' | 'orden_id'>[],
    creadoPor: string | null,
  ): Promise<OdooOrdenCompra> {
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

  /** Publica la OC en Odoo (borrador + líneas). Idempotente en el servidor (D3); la OC puede quedar `incierto`. */
  async publicar(ordenId: string): Promise<OdooOrdenCompra> {
    await this.odoo.publicarOrden(ordenId);
    return this.getById(ordenId);
  }

  /**
   * D4 — confirmar/cancelar: Odoo primero, SGC después. Si Odoo rechaza, el estado
   * SGC no cambia. recibida/recibida_parcial siguen siendo solo-SGC (la recepción
   * no se valida en Odoo durante el piloto). Transition validity is enforced server-side.
   * CT3c — pasar a "recibida" con reconciliación incompleta exige `motivo` (solo admin).
   */
  async updateEstado(orden: Pick<OdooOrdenCompra, 'id' | 'odoo_sync_estado'>, estado: OrdenEstado, motivo?: string | null): Promise<void> {
    const publicada = orden.odoo_sync_estado === 'publicada' || orden.odoo_sync_estado === 'confirmada';
    if (estado === 'aprobada') {
      if (!publicada) throw new Error('Publica la orden en Odoo antes de aprobarla.');
      if (orden.odoo_sync_estado !== 'confirmada') await this.odoo.confirmarOrden(orden.id);
    } else if (estado === 'cancelada' && publicada) {
      await this.odoo.cancelarOrden(orden.id);
    }
    const { error } = await this.supabase.client
      .schema('sgc')
      .rpc('actualizar_estado_orden', { p_orden_id: orden.id, p_nuevo_estado: estado, p_motivo: motivo ?? null });

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

  /** CY24 (#24, D6) — feature flag del selector de producto Odoo en "crear OC".
   *  Apagado por defecto: con el flag apagado el flujo es idéntico al de hoy. */
  async odooCompraPilotoHabilitado(): Promise<boolean> {
    const { data, error } = await this.supabase.client.rpc('odoo_compras_piloto_habilitado');
    if (error) return false;
    return data === true;
  }

  /** CY24 (#24, D7) — escribe la identidad Odoo de un renglón YA creado (no se
   *  toca crear_orden_compra, D7). Guarda el snapshot completo (AT11). */
  async vincularProductoOdoo(itemId: string, producto: OdooProductoCompra): Promise<void> {
    const { error } = await this.supabase.client.rpc('vincular_item_producto_odoo', {
      p_item_id: itemId,
      p_odoo_product_id: producto.id,
      p_odoo_uom_id: producto.unidad_compra_id,
      p_odoo_snapshot: producto,
    });
    if (error) throw new Error(error.message);
  }
}
