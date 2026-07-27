import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';
import { SignedUrlCache, ImgTransform } from './signed-url-cache.service';
import { Articulo, ArticuloFormData } from '../models/articulo.model';

/** Z17 — bucket compartido de inventario; las fotos de artículo van bajo articulo/{id}/. */
const ARTICULOS_BUCKET = 'inventario';

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

  async generateNextCode(): Promise<string> {
    const { data, error } = await this.supabase.client
      .from('articulos')
      .select('codigo')
      .like('codigo', 'ART-%')
      .order('codigo', { ascending: false })
      .limit(1);

    if (error) throw new Error(error.message);

    const last = data?.[0]?.codigo as string | undefined;
    const lastNumber = last ? parseInt(last.replace('ART-', ''), 10) || 0 : 0;
    return `ART-${String(lastNumber + 1).padStart(4, '0')}`;
  }

  async create(formData: ArticuloFormData): Promise<Articulo> {
    const codigo = await this.generateNextCode();
    const { data, error } = await this.supabase.client
      .from('articulos')
      .insert({ ...formData, codigo })
      .select('*, categoria:categorias_inventario(nombre)')
      .single();

    if (error) throw new Error(error.message);
    return data as unknown as Articulo;
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
