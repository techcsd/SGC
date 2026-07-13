import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';
import { CuadreObra, CuadreItem, CuadreItemFormData } from '../models/cuadre.model';

@Injectable({ providedIn: 'root' })
export class CuadreService {
  private supabase = inject(SupabaseService);

  async getCuadre(proyectoId: string): Promise<CuadreObra | null> {
    const { data, error } = await this.supabase.client
      .from('cuadre_obra')
      .select('*')
      .eq('proyecto_id', proyectoId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (data as unknown as CuadreObra) ?? null;
  }

  async getItems(proyectoId: string): Promise<CuadreItem[]> {
    const { data, error } = await this.supabase.client
      .from('cuadre_items')
      .select('*')
      .eq('proyecto_id', proyectoId)
      .order('categoria', { ascending: true })
      .order('orden', { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as CuadreItem[];
  }

  /** Inicializa el cuadre y copia el kit de inicio (idempotente). Devuelve nº de items del kit. */
  async inicializar(proyectoId: string, bodegaId: string | null): Promise<number> {
    const { data, error } = await this.supabase.client.rpc('copiar_kit_a_cuadre', {
      p_proyecto_id: proyectoId,
      p_bodega_id: bodegaId,
    });
    if (error) throw new Error(error.message);
    return (data as number) ?? 0;
  }

  async setBodegaYFase(proyectoId: string, patch: { bodega_id?: string | null; fase_activa?: number }): Promise<void> {
    const { error } = await this.supabase.client
      .from('cuadre_obra')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('proyecto_id', proyectoId);
    if (error) throw new Error(error.message);
  }

  async addItem(proyectoId: string, item: CuadreItemFormData): Promise<CuadreItem> {
    const { data, error } = await this.supabase.client
      .from('cuadre_items')
      .insert({ proyecto_id: proyectoId, es_kit: false, ...item })
      .select('*')
      .single();
    if (error) throw new Error(error.message);
    return data as unknown as CuadreItem;
  }

  async updateItem(id: string, patch: Partial<CuadreItemFormData>): Promise<void> {
    const { error } = await this.supabase.client
      .from('cuadre_items')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw new Error(error.message);
  }

  async removeItem(id: string): Promise<void> {
    const { error } = await this.supabase.client.from('cuadre_items').delete().eq('id', id);
    if (error) throw new Error(error.message);
  }

  /** Consumo total por artículo (todas las fases) para mostrar consumido/disponible. */
  async getConsumoPorArticulo(proyectoId: string): Promise<Record<string, number>> {
    const { data, error } = await this.supabase.client
      .from('cuadre_consumo')
      .select('articulo_id, cantidad')
      .eq('proyecto_id', proyectoId);
    if (error) throw new Error(error.message);
    const map: Record<string, number> = {};
    for (const r of (data ?? []) as { articulo_id: string; cantidad: number }[]) {
      map[r.articulo_id] = (map[r.articulo_id] ?? 0) + Number(r.cantidad);
    }
    return map;
  }
}
