import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';
import { StockPorBodega } from '../models/stock.model';

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

  /** Returns a map of articulo_id → total quantity across all bodegas */
  buildTotalMap(stock: StockPorBodega[]): Map<string, number> {
    const map = new Map<string, number>();
    for (const row of stock) {
      map.set(row.articulo_id, (map.get(row.articulo_id) ?? 0) + row.cantidad);
    }
    return map;
  }
}
