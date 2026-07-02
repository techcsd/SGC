import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';
import { SalidaInventario, SalidaFormData } from '../models/salida.model';

const SELECT_QUERY =
  '*, bodega:bodegas(nombre), proyecto:proyectos(nombre), detalle_salidas(*, articulo:articulos(nombre, codigo, unidad))';

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

  async getById(id: string): Promise<SalidaInventario> {
    const { data, error } = await this.supabase.client
      .from('salidas_inventario')
      .select(SELECT_QUERY)
      .eq('id', id)
      .single();

    if (error) throw new Error(error.message);
    return data as unknown as SalidaInventario;
  }

  /** Atomic insert (header + items) with server-side stock validation, via RPC. */
  async create(payload: SalidaFormData, userId: string | null): Promise<SalidaInventario> {
    const { items, ...header } = payload;

    const { data: salidaId, error } = await this.supabase.client.rpc('registrar_salida_inventario', {
      p_fecha: header.fecha,
      p_bodega_id: header.bodega_id,
      p_proyecto_id: header.proyecto_id,
      p_motivo: header.motivo,
      p_responsable: header.responsable,
      p_observaciones: header.observaciones,
      p_creado_por: userId,
      p_items: items,
    });

    if (error) throw new Error(error.message);

    const { data, error: fetchError } = await this.supabase.client
      .from('salidas_inventario')
      .select(SELECT_QUERY)
      .eq('id', salidaId as string)
      .single();

    if (fetchError) throw new Error(fetchError.message);
    return data as unknown as SalidaInventario;
  }
}
