import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';
import { OrdenCompra, OrdenCompraItem, OrdenEstado } from '../models/orden-compra.model';

export interface OrdenCompraPayload {
  proveedor_id: string;
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

  generateNumero(): string {
    return 'OC-' + Date.now();
  }

  async getAll(): Promise<OrdenCompra[]> {
    const { data, error } = await this.supabase.client
      .schema('sgc')
      .from('ordenes_compra')
      .select('*, proveedor:proveedores(nombre)')
      .order('created_at', { ascending: false });

    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as OrdenCompra[];
  }

  async getById(id: string): Promise<OrdenCompra> {
    const { data, error } = await this.supabase.client
      .schema('sgc')
      .from('ordenes_compra')
      .select('*, proveedor:proveedores(nombre), items:orden_compra_items(*)')
      .eq('id', id)
      .single();

    if (error) throw new Error(error.message);
    return data as unknown as OrdenCompra;
  }

  async create(orden: OrdenCompraPayload, items: Omit<OrdenCompraItem, 'id' | 'orden_id'>[]): Promise<OrdenCompra> {
    const numero = this.generateNumero();

    const { data: ordenData, error: ordenError } = await this.supabase.client
      .schema('sgc')
      .from('ordenes_compra')
      .insert({ ...orden, numero })
      .select('*')
      .single();

    if (ordenError) throw new Error(ordenError.message);
    const created = ordenData as unknown as OrdenCompra;

    if (items.length > 0) {
      const itemRows = items.map((item) => ({
        orden_id: created.id,
        articulo_id: item.articulo_id,
        descripcion: item.descripcion,
        cantidad: item.cantidad,
        precio_unitario: item.precio_unitario,
        total: item.total,
      }));

      const { error: itemsError } = await this.supabase.client
        .schema('sgc')
        .from('orden_compra_items')
        .insert(itemRows);

      if (itemsError) throw new Error(itemsError.message);
    }

    return this.getById(created.id);
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
