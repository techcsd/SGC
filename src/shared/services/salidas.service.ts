import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';
import { SalidaInventario, SalidaFormData } from '../models/salida.model';

const SELECT_QUERY =
  '*, bodega:bodegas(nombre), obra:obras(nombre), detalle_salidas(*, articulo:articulos(nombre, codigo, unidad))';

@Injectable({ providedIn: 'root' })
export class SalidasService {
  private supabase = inject(SupabaseService);

  async getAll(): Promise<SalidaInventario[]> {
    const { data, error } = await this.supabase.client
      .from('salidas_inventario')
      .select(SELECT_QUERY)
      .order('created_at', { ascending: false });

    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as SalidaInventario[];
  }

  async create(payload: SalidaFormData, userId: string | null): Promise<SalidaInventario> {
    const { items, ...header } = payload;

    const { data: salida, error: salidaError } = await this.supabase.client
      .from('salidas_inventario')
      .insert({ ...header, creado_por: userId })
      .select('id')
      .single();

    if (salidaError) throw new Error(salidaError.message);

    const salidaId = (salida as { id: string }).id;

    const { error: itemsError } = await this.supabase.client
      .from('detalle_salidas')
      .insert(items.map((item) => ({ ...item, salida_id: salidaId })));

    if (itemsError) throw new Error(itemsError.message);

    const { data, error } = await this.supabase.client
      .from('salidas_inventario')
      .select(SELECT_QUERY)
      .eq('id', salidaId)
      .single();

    if (error) throw new Error(error.message);
    return data as unknown as SalidaInventario;
  }
}
