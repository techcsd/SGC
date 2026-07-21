import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';
import { StockPorBodega } from '../models/stock.model';

export interface ReposicionRow {
  articulo_id: string;
  nombre: string;
  codigo: string;
  unidad: string;
  minimo: number;
  actual: number;
  faltante: number;
}

@Injectable({ providedIn: 'root' })
export class StockService {
  private supabase = inject(SupabaseService);

  async getAll(): Promise<StockPorBodega[]> {
    const { data, error } = await this.supabase.client
      .from('stock_por_bodega')
      .select('*, bodega:bodegas(nombre)');

    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as StockPorBodega[];
  }

  async getByArticulo(articuloId: string): Promise<StockPorBodega[]> {
    const { data, error } = await this.supabase.client
      .from('stock_por_bodega')
      .select('*, bodega:bodegas(nombre)')
      .eq('articulo_id', articuloId);

    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as StockPorBodega[];
  }

  /**
   * A3.1 — Reposición por almacén: artículos cuyo stock en ese almacén está en o
   * por debajo del mínimo (`articulos.stock_minimo`). Señal operativa para el
   * Guarda-Almacén — cantidades solamente, sin cuadre ni montos.
   */
  /** R10 — `bodegaId=null` → vista global (todas las bodegas, misma fórmula que Reportes). */
  async getReposicion(bodegaId: string | null): Promise<ReposicionRow[]> {
    // RPC security-definer: superpone el mínimo del kit del cuadre sobre el
    // stock_minimo del artículo, sin exponer cuadre ni montos (apta para obra).
    const { data, error } = await this.supabase.client.rpc('reposicion_almacen', { p_bodega_id: bodegaId });
    if (error) throw new Error(error.message);
    return ((data ?? []) as ReposicionRow[]).map((r) => ({
      ...r,
      minimo: Number(r.minimo),
      actual: Number(r.actual),
      faltante: Number(r.faltante),
    }));
  }

  /** Returns a map of articulo_id → total quantity across all bodegas */
  buildTotalMap(stock: StockPorBodega[]): Map<string, number> {
    const map = new Map<string, number>();
    for (const row of stock) {
      map.set(row.articulo_id, (map.get(row.articulo_id) ?? 0) + row.cantidad);
    }
    return map;
  }
}
