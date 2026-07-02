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
    });

    if (error) throw new Error(error.message);
    return this.getById(ordenId as string);
  }

  async updateEstado(id: string, estado: OrdenEstado): Promise<void> {
    const { error } = await this.supabase.client
      .schema('sgc')
      .from('ordenes_compra')
      .update({ estado, updated_at: new Date().toISOString() })
      .eq('id', id);

    if (error) throw new Error(error.message);
  }
}
