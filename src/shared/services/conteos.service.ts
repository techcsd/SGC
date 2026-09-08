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
  es_prueba?: boolean;
  bodega_id?: string | null;
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
        'id, motivo, tipo, observaciones, created_at, es_prueba, bodega_id, bodega:bodegas(nombre), creado:usuarios(nombre), items:conteo_items(cantidad_antes, cantidad_contada, articulo:articulos(nombre, codigo))',
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

  // ── BL4 — Conteo físico con ciclo de vida (no toca el ledger; rebasa apertura) ──
  /** Abre (o reanuda) un borrador de conteo físico de una bodega. Devuelve el id. */
  async conteoFisicoAbrir(bodegaId: string, ciego = false): Promise<string> {
    const { data, error } = await this.supabase.client.rpc('conteo_fisico_abrir', { p_bodega_id: bodegaId, p_ciego: ciego });
    if (error) throw new Error(error.message);
    return data as string;
  }
  /** Guarda (autosave) los items del borrador — reemplaza los anteriores. */
  async conteoFisicoGuardar(conteoId: string, items: { articulo_id: string; cantidad_contada: number | null }[]): Promise<void> {
    const { error } = await this.supabase.client.rpc('conteo_fisico_guardar', { p_conteo_id: conteoId, p_items: items });
    if (error) throw new Error(error.message);
  }
  /** Cierra el borrador (→ contado, listo para aplicar). */
  async conteoFisicoCerrar(conteoId: string): Promise<void> {
    const { error } = await this.supabase.client.rpc('conteo_fisico_cerrar', { p_conteo_id: conteoId });
    if (error) throw new Error(error.message);
  }
  /** Aplica el conteo: reconcilia el stock (rebasa apertura, sin movimientos). */
  async conteoFisicoAplicar(conteoId: string, motivo: string): Promise<{ ok: boolean; ajustados: number }> {
    const { data, error } = await this.supabase.client.rpc('conteo_fisico_aplicar', { p_conteo_id: conteoId, p_motivo: motivo });
    if (error) throw new Error(error.message);
    return (data ?? { ok: false, ajustados: 0 }) as { ok: boolean; ajustados: number };
  }
  /** Deshace un conteo aplicado (restaura la apertura previa). */
  async conteoFisicoDeshacer(conteoId: string): Promise<void> {
    const { error } = await this.supabase.client.rpc('conteo_fisico_deshacer', { p_conteo_id: conteoId });
    if (error) throw new Error(error.message);
  }
  /** Detalle del conteo (cabecera + items) para reanudar la hoja. */
  async conteoFisicoDetalle(conteoId: string): Promise<{ estado: string; ciego: boolean; items: { articulo_id: string; cantidad_contada: number | null }[] }> {
    const { data, error } = await this.supabase.client.rpc('conteo_fisico_detalle', { p_conteo_id: conteoId });
    if (error) throw new Error(error.message);
    return (data ?? { estado: '', ciego: false, items: [] }) as { estado: string; ciego: boolean; items: { articulo_id: string; cantidad_contada: number | null }[] };
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
