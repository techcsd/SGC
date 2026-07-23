import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';
import { SignedUrlCache, ImgTransform } from './signed-url-cache.service';
import { EntradaInventario, EntradaFormData } from '../models/entrada.model';

const SELECT_QUERY =
  '*, bodega:bodegas(nombre), proveedor:proveedores(nombre), orden_compra:ordenes_compra(numero), origen_proyecto:proyectos!entradas_inventario_origen_proyecto_id_fkey(nombre), detalle_entradas(*, articulo:articulos(nombre, codigo, unidad))';

@Injectable({ providedIn: 'root' })
export class EntradasService {
  private supabase = inject(SupabaseService);
  private cache = inject(SignedUrlCache);

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
  async getFotoUrl(path: string, transform?: ImgTransform): Promise<string> {
    return this.cache.signed('inventario', path, transform);
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
    let entradaId: unknown;

    if (header.origen_tipo === 'devolucion_obra') {
      // P12 — traspaso atómico desde el almacén de la obra de origen (RPC nuevo).
      const { data, error } = await this.supabase.client.rpc('registrar_devolucion_obra', {
        p_fecha: header.fecha,
        p_bodega_destino_id: header.bodega_id,
        p_origen_proyecto_id: header.origen_proyecto_id ?? null,
        p_descontar: header.descontar_origen ?? false,
        p_referencia: header.referencia,
        p_observaciones: header.observaciones,
        p_creado_por: userId,
        p_items: items,
      });
      if (error) throw new Error(error.message);
      entradaId = data;
    } else {
      const { data, error } = await this.supabase.client.rpc('registrar_entrada_inventario', {
        p_fecha: header.fecha,
        p_bodega_id: header.bodega_id,
        p_proveedor_id: header.proveedor_id,
        p_orden_compra_id: header.orden_compra_id,
        p_referencia: header.referencia,
        p_observaciones: header.observaciones,
        p_creado_por: userId,
        p_items: items,
        p_origen_tipo: header.origen_tipo ?? null,
        p_origen_proyecto_id: header.origen_proyecto_id ?? null,
      });
      if (error) throw new Error(error.message);
      entradaId = data;
    }

    const { data, error: fetchError } = await this.supabase.client
      .from('entradas_inventario')
      .select(SELECT_QUERY)
      .eq('id', entradaId as string)
      .single();

    if (fetchError) throw new Error(fetchError.message);
    return data as unknown as EntradaInventario;
  }
}
