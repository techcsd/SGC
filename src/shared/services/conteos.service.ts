import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';

export interface ConteoItem {
  cantidad_antes: number;
  cantidad_contada: number;
  articulo?: { nombre: string; codigo: string } | null;
}

export interface Conteo {
  id: string;
  motivo: string | null;
  tipo?: string;
  observaciones?: string | null;
  created_at: string;
  bodega?: { nombre: string } | null;
  creado?: { nombre: string } | null;
  items?: ConteoItem[];
}

export interface StockBodegaRow {
  articulo_id: string;
  cantidad: number;
  articulo?: { nombre: string; codigo: string };
}

@Injectable({ providedIn: 'root' })
export class ConteosService {
  private supabase = inject(SupabaseService);

  /** Physical-count / stock-adjustment history. RLS: inventario/admin. */
  async getAll(): Promise<Conteo[]> {
    const { data, error } = await this.supabase.client
      .from('conteos_inventario')
      .select(
        'id, motivo, tipo, observaciones, created_at, bodega:bodegas(nombre), creado:usuarios(nombre), items:conteo_items(cantidad_antes, cantidad_contada, articulo:articulos(nombre, codigo))',
      )
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as Conteo[];
  }

  /** Stock actual de un almacén, para prellenar el chequeo semanal. */
  async getStockDeBodega(bodegaId: string): Promise<StockBodegaRow[]> {
    const { data, error } = await this.supabase.client
      .from('stock_por_bodega')
      .select('articulo_id, cantidad, articulo:articulos(nombre, codigo)')
      .eq('bodega_id', bodegaId);
    if (error) throw new Error(error.message);
    // PostgREST devuelve numeric como string; normaliza para comparaciones fiables.
    return ((data ?? []) as unknown as StockBodegaRow[]).map((r) => ({ ...r, cantidad: Number(r.cantidad) }));
  }

  /** A5 — registra un chequeo semanal (conteo físico) y genera alertas de diferencia. */
  async registrarChequeoSemanal(
    bodegaId: string,
    observaciones: string | null,
    items: { articulo_id: string; cantidad_contada: number }[],
  ): Promise<string> {
    const id = crypto.randomUUID();
    const { data, error } = await this.supabase.client.rpc('registrar_chequeo_semanal', {
      p_id: id,
      p_bodega_id: bodegaId,
      p_observaciones: observaciones,
      p_items: items,
    });
    if (error) throw new Error(error.message);
    return (data as string) ?? id;
  }
}
