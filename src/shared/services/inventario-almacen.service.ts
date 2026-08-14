import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';

/** AP2 — fila del inventario de un almacén. */
export interface InventarioAlmacenItem {
  articulo_id: string;
  codigo: string | null;
  nombre: string;
  categoria: string | null;
  unidad: string | null;
  propiedad: string | null;
  cantidad: number;
  apertura: number;
  es_cero: boolean;
  es_prueba: boolean;
}

/** AP3 — un movimiento del kardex de un artículo×almacén. */
export interface KardexMovimiento {
  mov: 'entrada' | 'salida' | 'ajuste';
  referencia_id: string;
  referencia_tipo: string;
  conduce_id: string | null;
  conduce_numero: string | null;
  fecha: string;
  ts: string;
  cantidad: number;
  delta: number;
  saldo: number;
  origen: string | null;
  destino: string | null;
  entrega_nombre: string | null;
  recibe_nombre: string | null;
  transporte_nombre: string | null;
  conductor_id: string | null;
  firmas: { rol: string; nombre?: string; firma_path: string; firmado_en?: string }[];
  fotos: string[];
}

/** AP3 — resultado completo del kardex. */
export interface Kardex {
  apertura: number;
  saldo_actual: number;
  serie: { ts: string; saldo: number }[];
  movimientos: KardexMovimiento[];
}

export interface KardexFiltros {
  tipo?: 'entrada' | 'salida' | 'ajuste' | null;
  transportista?: string | null;
  entrega?: string | null;
  desde?: string | null;
  hasta?: string | null;
}

@Injectable({ providedIn: 'root' })
export class InventarioAlmacenService {
  private supabase = inject(SupabaseService);

  /** AP2 — inventario de un almacén (artículos con existencias). */
  async getInventario(
    bodegaId: string,
    incluirCero = true,
    busqueda: string | null = null,
  ): Promise<InventarioAlmacenItem[]> {
    const { data, error } = await this.supabase.client.rpc('inventario_almacen', {
      p_bodega_id: bodegaId,
      p_incluir_cero: incluirCero,
      p_busqueda: busqueda,
    });
    if (error) throw new Error(error.message);
    return (data ?? []) as InventarioAlmacenItem[];
  }

  /** AP3 — kardex de un artículo en un almacén (movimientos + serie del stock). */
  async getKardex(articuloId: string, bodegaId: string, filtros?: KardexFiltros): Promise<Kardex> {
    const { data, error } = await this.supabase.client.rpc('kardex_articulo', {
      p_articulo_id: articuloId,
      p_bodega_id: bodegaId,
      p_tipo: filtros?.tipo ?? null,
      p_transportista: filtros?.transportista ?? null,
      p_entrega: filtros?.entrega ?? null,
      p_desde: filtros?.desde ?? null,
      p_hasta: filtros?.hasta ?? null,
    });
    if (error) throw new Error(error.message);
    return (data ?? { apertura: 0, saldo_actual: 0, serie: [], movimientos: [] }) as Kardex;
  }

  /** AP5 — fija el dato de apertura (solo admin; sin movimiento). */
  async setApertura(articuloId: string, bodegaId: string, cantidad: number): Promise<void> {
    const { error } = await this.supabase.client.rpc('set_apertura', {
      p_articulo_id: articuloId,
      p_bodega_id: bodegaId,
      p_cantidad: cantidad,
    });
    if (error) throw new Error(error.message);
  }
}
