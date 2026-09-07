import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';
import { SignedUrlCache, ImgTransform } from './signed-url-cache.service';
import { comprimirImagen } from '../utils/comprimir-imagen.util';
import { Articulo, ArticuloFormData } from '../models/articulo.model';

/** Z17 — bucket compartido de inventario; las fotos de artículo van bajo articulo/{id}/. */
const ARTICULOS_BUCKET = 'inventario';

/** AU12 — apodo/alias de un artículo (con traza de quién lo agregó). */
export interface ArticuloAlias {
  id: string;
  alias: string;
  creado_por: string | null;
  creador: string | null;
  created_at: string;
}

@Injectable({ providedIn: 'root' })
export class ArticulosService {
  private supabase = inject(SupabaseService);
  private cache = inject(SignedUrlCache);

  async getAll(): Promise<Articulo[]> {
    const { data, error } = await this.supabase.client
      .from('articulos')
      .select('*, categoria:categorias_inventario(nombre)')
      // Orden oficial del catálogo (Excel) dentro de cada categoría, luego nombre.
      .order('orden', { ascending: true, nullsFirst: false })
      .order('nombre');

    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as Articulo[];
  }

  async getById(id: string): Promise<Articulo> {
    const { data, error } = await this.supabase.client
      .from('articulos')
      .select('*, categoria:categorias_inventario(nombre)')
      .eq('id', id)
      .single();

    if (error) throw new Error(error.message);
    return data as unknown as Articulo;
  }

  /**
   * BJ6/AU1 — el código lo genera el SERVIDOR (`crear_articulo_app` →
   * `CSD-<orden categoría 2d>-<seq 3d>`), fuente ÚNICA compartida con la app. Antes
   * la web acuñaba `ART-####` en el cliente (dos generadores compitiendo). El RPC
   * cubre nombre/categoría/unidad/propiedad/nota; los demás campos se completan con
   * un update inmediato. Requiere categoría (el prefijo del código sale de su orden).
   */
  async create(formData: ArticuloFormData): Promise<Articulo> {
    if (formData.categoria_id == null) {
      throw new Error('Selecciona una categoría para el artículo (el código depende de ella).');
    }
    const { data: res, error } = await this.supabase.client.rpc('crear_articulo_app', {
      p_nombre: formData.nombre,
      p_categoria_id: formData.categoria_id,
      p_unidad: formData.unidad ?? null,
      p_propiedad: formData.propiedad ?? 'propio_csd',
      p_nota: formData.nota ?? null,
    });
    if (error) throw new Error(error.message);
    const { id } = res as { id: string; codigo: string };
    // Completa los campos que el RPC no cubre (nunca copiamos código/imagen aquí).
    return await this.update(id, {
      descripcion: formData.descripcion ?? null,
      stock_minimo: formData.stock_minimo,
      stock_maximo: formData.stock_maximo ?? null,
      precio_estimado: formData.precio_estimado ?? null,
      activo: formData.activo,
      requiere_talla: formData.requiere_talla ?? false,
      entrega_en_mano: formData.entrega_en_mano ?? false,
      es_prueba: formData.es_prueba ?? false,
    });
  }

  async update(id: string, formData: Partial<ArticuloFormData>): Promise<Articulo> {
    const { data, error } = await this.supabase.client
      .from('articulos')
      .update({ ...formData, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('*, categoria:categorias_inventario(nombre)')
      .single();

    if (error) throw new Error(error.message);
    return data as unknown as Articulo;
  }

  async toggleActivo(id: string, activo: boolean): Promise<void> {
    const { error } = await this.supabase.client
      .from('articulos')
      .update({ activo, updated_at: new Date().toISOString() })
      .eq('id', id);

    if (error) throw new Error(error.message);
  }

  /** Z11 — ajusta el stock de un artículo en una bodega como AJUSTE trazable
   *  (crea un conteo tipo 'ajuste'; nunca update silencioso). */
  async ajustarStock(articuloId: string, bodegaId: string, nuevaCantidad: number, motivo?: string): Promise<void> {
    const { error } = await this.supabase.client.rpc('ajustar_stock_articulo', {
      p_articulo_id: articuloId,
      p_bodega_id: bodegaId,
      p_nueva_cantidad: nuevaCantidad,
      p_motivo: motivo ?? 'Ajuste manual desde edición de artículo',
    });
    if (error) throw new Error(error.message);
  }

  // ── AU12 — apodos / alias de artículos ──────────────────────────────────────
  async listarApodos(articuloId: string): Promise<ArticuloAlias[]> {
    const { data, error } = await this.supabase.client.rpc('articulo_alias_listar', { p_articulo_id: articuloId });
    if (error) throw new Error(error.message);
    return (data ?? []) as ArticuloAlias[];
  }

  async agregarApodo(articuloId: string, alias: string): Promise<string> {
    const { data, error } = await this.supabase.client.rpc('articulo_alias_agregar', {
      p_articulo_id: articuloId,
      p_alias: alias,
    });
    if (error) throw new Error(error.message);
    return data as string;
  }

  async eliminarApodo(id: string): Promise<void> {
    const { error } = await this.supabase.client.rpc('articulo_alias_eliminar', { p_id: id });
    if (error) throw new Error(error.message);
  }

  /** Z16 — marca rápida de propiedad (lista admin de backfill). */
  async setPropiedad(id: string, propiedad: 'propio_csd' | 'alquilado'): Promise<void> {
    const { error } = await this.supabase.client
      .from('articulos')
      .update({ propiedad, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw new Error(error.message);
  }

  // ── Z17 — Foto del artículo (bucket `inventario`, path articulo/{id}/…) ─────

  /** Sube una foto y devuelve su storage path (para guardar en imagen_url). */
  async uploadFoto(articuloId: string, file: File): Promise<string> {
    file = await comprimirImagen(file, 'evidencia');
    const safeName =
      (file.name || 'foto')
        .replace(/\.[^.]+$/, '')
        .replace(/[^a-zA-Z0-9_-]+/g, '-')
        .slice(0, 40) || 'foto';
    const path = `articulo/${articuloId}/${crypto.randomUUID()}-${safeName}.jpg`;
    const { error } = await this.supabase.client.storage
      .from(ARTICULOS_BUCKET)
      .upload(path, file, { upsert: true, contentType: file.type || 'image/jpeg' });
    if (error) throw new Error(error.message);
    return path;
  }

  /** Resuelve un path de foto a URL firmada cacheada (W9). Thumbnail si transform. */
  async getFotoUrl(path: string, transform?: ImgTransform): Promise<string> {
    return this.cache.signed(ARTICULOS_BUCKET, path, transform);
  }

  /** Z17 — últimos movimientos (salidas/entradas) del artículo, para el detalle. */
  async getUltimosMovimientos(
    articuloId: string,
    limit = 10,
  ): Promise<{ tipo: string; fecha: string; cantidad: number; bodega: string | null; proyecto: string | null }[]> {
    const { data, error } = await this.supabase.client.rpc('ultimos_movimientos_articulo', {
      p_articulo_id: articuloId,
      p_limit: limit,
    });
    if (error) throw new Error(error.message);
    return (data ?? []) as { tipo: string; fecha: string; cantidad: number; bodega: string | null; proyecto: string | null }[];
  }
}
