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
  async getReposicion(bodegaId: string): Promise<ReposicionRow[]> {
    // Artículos activos con mínimo > 0, y su stock en este almacén (si existe).
    const [artsRes, stockRes] = await Promise.all([
      this.supabase.client
        .from('articulos')
        .select('id, nombre, codigo, unidad, stock_minimo')
        .eq('activo', true)
        .gt('stock_minimo', 0),
      this.supabase.client.from('stock_por_bodega').select('articulo_id, cantidad').eq('bodega_id', bodegaId),
    ]);
    if (artsRes.error) throw new Error(artsRes.error.message);
    if (stockRes.error) throw new Error(stockRes.error.message);
    const stockMap = new Map<string, number>();
    for (const s of (stockRes.data ?? []) as { articulo_id: string; cantidad: number }[]) {
      stockMap.set(s.articulo_id, Number(s.cantidad));
    }
    const rows: ReposicionRow[] = [];
    for (const a of (artsRes.data ?? []) as {
      id: string;
      nombre: string;
      codigo: string;
      unidad: string;
      stock_minimo: number;
    }[]) {
      const actual = stockMap.get(a.id) ?? 0;
      const minimo = Number(a.stock_minimo);
      if (actual <= minimo) {
        rows.push({
          articulo_id: a.id,
          nombre: a.nombre,
          codigo: a.codigo,
          unidad: a.unidad,
          minimo,
          actual,
          faltante: Math.max(0, minimo - actual),
        });
      }
    }
    // Más urgente primero (mayor faltante).
    return rows.sort((x, y) => y.faltante - x.faltante);
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
