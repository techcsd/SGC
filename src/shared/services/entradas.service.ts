import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';
import { EntradaInventario, EntradaFormData } from '../models/entrada.model';

const SELECT_QUERY =
  '*, bodega:bodegas(nombre), proveedor:proveedores(nombre), orden_compra:ordenes_compra(numero), detalle_entradas(*, articulo:articulos(nombre, codigo, unidad))';

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

  /** Sube una foto de evidencia (web) al bucket `inventario` y la enlaza a la entrada.
   *  Paridad con la app de campo: lo que la móvil captura, la web también. */
  async subirFoto(entradaId: string, file: File): Promise<string> {
    const safe = (file.name || 'foto').replace(/[^a-zA-Z0-9_.-]+/g, '-').slice(0, 40);
    const path = `entrada/${entradaId}/${crypto.randomUUID()}-${safe}`;
    const { error } = await this.supabase.client.storage.from('inventario').upload(path, file);
    if (error) throw new Error(error.message);
    const { error: updErr } = await this.supabase.client
      .from('entradas_inventario')
      .update({ foto_path: path })
      .eq('id', entradaId);
    if (updErr) throw new Error(updErr.message);
    return path;
  }

  /** Signed URL for the field-captured evidence photo (private `inventario` bucket). */
  async getFotoUrl(path: string): Promise<string> {
    const { data, error } = await this.supabase.client.storage
      .from('inventario')
      .createSignedUrl(path, 3600);
    if (error) throw new Error(error.message);
    return data.signedUrl;
  }

  async getByOrdenCompra(ordenCompraId: string): Promise<EntradaInventario[]> {
    const { data, error } = await this.supabase.client
      .from('entradas_inventario')
      .select(SELECT_QUERY)
      .eq('orden_compra_id', ordenCompraId)
      .order('created_at', { ascending: false });

    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as EntradaInventario[];
  }

  async create(payload: EntradaFormData, userId: string | null): Promise<EntradaInventario> {
    const { items, ...header } = payload;

    const { data: entradaId, error } = await this.supabase.client.rpc('registrar_entrada_inventario', {
      p_fecha: header.fecha,
      p_bodega_id: header.bodega_id,
      p_proveedor_id: header.proveedor_id,
      p_orden_compra_id: header.orden_compra_id,
      p_referencia: header.referencia,
      p_observaciones: header.observaciones,
      p_creado_por: userId,
      p_items: items,
    });

    if (error) throw new Error(error.message);

    const { data, error: fetchError } = await this.supabase.client
      .from('entradas_inventario')
      .select(SELECT_QUERY)
      .eq('id', entradaId as string)
      .single();

    if (fetchError) throw new Error(fetchError.message);
    return data as unknown as EntradaInventario;
  }
}
