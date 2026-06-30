import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';
import { EntradaInventario, EntradaFormData } from '../models/entrada.model';

const SELECT_QUERY =
  '*, bodega:bodegas(nombre), proveedor:proveedores(nombre), detalle_entradas(*, articulo:articulos(nombre, codigo, unidad))';

@Injectable({ providedIn: 'root' })
export class EntradasService {
  private supabase = inject(SupabaseService);

  async getAll(): Promise<EntradaInventario[]> {
    const { data, error } = await this.supabase.client
      .from('entradas_inventario')
      .select(SELECT_QUERY)
      .order('created_at', { ascending: false });

    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as EntradaInventario[];
  }

  async create(payload: EntradaFormData, userId: string | null): Promise<EntradaInventario> {
    const { items, ...header } = payload;

    const { data: entrada, error: entradaError } = await this.supabase.client
      .from('entradas_inventario')
      .insert({ ...header, creado_por: userId })
      .select('id')
      .single();

    if (entradaError) throw new Error(entradaError.message);

    const entradaId = (entrada as { id: string }).id;

    const { error: itemsError } = await this.supabase.client
      .from('detalle_entradas')
      .insert(items.map((item) => ({ ...item, entrada_id: entradaId })));

    if (itemsError) throw new Error(itemsError.message);

    const { data, error } = await this.supabase.client
      .from('entradas_inventario')
      .select(SELECT_QUERY)
      .eq('id', entradaId)
      .single();

    if (error) throw new Error(error.message);
    return data as unknown as EntradaInventario;
  }
}
