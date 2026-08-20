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

  /** AP2/AU6 — inventario de un almacén. `incluirCatalogo=true` lista el catálogo
   *  completo (artículos aún sin fila en el almacén, con 0) para poder aperturarlos. */
  async getInventario(
    bodegaId: string,
    incluirCero = true,
    busqueda: string | null = null,
    incluirCatalogo = false,
  ): Promise<InventarioAlmacenItem[]> {
    const { data, error } = await this.supabase.client.rpc('inventario_almacen', {
      p_bodega_id: bodegaId,
      p_incluir_cero: incluirCero,
      p_busqueda: busqueda,
      p_incluir_catalogo: incluirCatalogo,
    });
    if (error) throw new Error(error.message);
    return (data ?? []) as InventarioAlmacenItem[];
  }

  /** AU6 — cuántos artículos tocaría la apertura en lote (para el preview). */
  async previewAperturaLote(opts: {
    bodegaId: string;
    incluirTodoCatalogo?: boolean;
    soloFaltantes?: boolean;
  }): Promise<number> {
    const { data, error } = await this.supabase.client.rpc('apertura_lote_preview', {
      p_bodega_id: opts.bodegaId,
      p_incluir_todo_catalogo: opts.incluirTodoCatalogo ?? false,
      p_solo_faltantes: opts.soloFaltantes ?? true,
    });
    if (error) throw new Error(error.message);
    return (data as number) ?? 0;
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

  /** AS10 — fija la apertura en LOTE para un almacén (solo admin). Devuelve
   *  cuántos artículos tocó. */
  async setAperturaLote(opts: {
    bodegaId: string;
    cantidad: number;
    soloFaltantes?: boolean;
    articuloIds?: string[] | null;
    incluirTodoCatalogo?: boolean;
  }): Promise<number> {
    const { data, error } = await this.supabase.client.rpc('set_apertura_lote', {
      p_bodega_id: opts.bodegaId,
      p_cantidad: opts.cantidad,
      p_solo_faltantes: opts.soloFaltantes ?? true,
      p_articulo_ids: opts.articuloIds ?? null,
      p_incluir_todo_catalogo: opts.incluirTodoCatalogo ?? false,
    });
    if (error) throw new Error(error.message);
    return (data as number) ?? 0;
  }

  /** AT12 — "Ajuste real": fija el stock al valor real informado SIN movimiento en
   *  kardex ni escalón en la gráfica (rebasa la línea base). Solo admin. */
  async ajusteRealStock(articuloId: string, bodegaId: string, cantidadReal: number): Promise<void> {
    const { error } = await this.supabase.client.rpc('ajuste_real_stock', {
      p_articulo_id: articuloId, p_bodega_id: bodegaId, p_cantidad_real: cantidadReal,
    });
    if (error) throw new Error(error.message);
  }

  /** AT12 — ajuste real en LOTE (carga por archivo). p_rows: [{articulo_id, cantidad}]. */
  async ajusteRealLote(
    bodegaId: string,
    rows: { articulo_id: string; cantidad: number }[],
  ): Promise<{ ok: number; errores: { fila: number; articulo_id?: string; msg: string }[] }> {
    const { data, error } = await this.supabase.client.rpc('ajuste_real_lote', {
      p_bodega_id: bodegaId, p_rows: rows,
    });
    if (error) throw new Error(error.message);
    return (data ?? { ok: 0, errores: [] }) as { ok: number; errores: { fila: number; articulo_id?: string; msg: string }[] };
  }

  /** AS11/Z11 — ajusta el stock de un artículo en un almacén (conteo/ajuste, deja
   *  traza en "Conteos y ajustes"). Sirve también para AGREGAR un artículo al
   *  almacén (si no tenía stock, la nueva cantidad lo crea). */
  async ajustarStock(
    articuloId: string,
    bodegaId: string,
    nuevaCantidad: number,
    motivo?: string | null,
  ): Promise<string> {
    const { data, error } = await this.supabase.client.rpc('ajustar_stock_articulo', {
      p_articulo_id: articuloId,
      p_bodega_id: bodegaId,
      p_nueva_cantidad: nuevaCantidad,
      p_motivo: motivo ?? 'Ajuste manual de inventario',
    });
    if (error) throw new Error(error.message);
    return data as string;
  }
}
