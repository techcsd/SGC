import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';
import { Bodega, BodegaFormData } from '../models/bodega.model';

/** AR3 — ubicación de almacén seleccionable (RPC sgc.ubicaciones_almacen). */
export interface UbicacionAlmacen {
  id: string;
  nombre: string;
  es_central: boolean;
  proyecto_id: string | null;
  proyecto_nombre: string | null;
}

@Injectable({ providedIn: 'root' })
export class BodegasService {
  private supabase = inject(SupabaseService);

  async getAll(): Promise<Bodega[]> {
    const { data, error } = await this.supabase.client
      .from('bodegas')
      .select('*, proyecto:proyectos(nombre)')
      .order('nombre');

    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as Bodega[];
  }

  /**
   * AR3 — fuente ÚNICA homologada de ubicaciones seleccionables (almacenes de obra
   * + centrales reales, activos, sin es_prueba ni duplicados sueltos). Úsala en
   * TODOS los selectores de ubicación; getAll() queda para el CRUD de bodegas.
   */
  async getSelectables(): Promise<UbicacionAlmacen[]> {
    const { data, error } = await this.supabase.client.rpc('ubicaciones_almacen');
    if (error) throw new Error(error.message);
    return (data ?? []) as UbicacionAlmacen[];
  }

  /** AP2 — un almacén por id (para la cabecera de la vista de inventario). */
  async getById(id: string): Promise<Bodega | null> {
    const { data, error } = await this.supabase.client
      .from('bodegas')
      .select('*, proyecto:proyectos(nombre)')
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (data ?? null) as unknown as Bodega | null;
  }

  async create(formData: BodegaFormData): Promise<Bodega> {
    const { data, error } = await this.supabase.client
      .from('bodegas')
      .insert(formData)
      .select('*, proyecto:proyectos(nombre)')
      .single();

    if (error) throw new Error(error.message);
    return data as unknown as Bodega;
  }

  async update(id: string, formData: Partial<BodegaFormData>): Promise<Bodega> {
    const { data, error } = await this.supabase.client
      .from('bodegas')
      .update(formData)
      .eq('id', id)
      .select('*, proyecto:proyectos(nombre)')
      .single();

    if (error) throw new Error(error.message);
    return data as unknown as Bodega;
  }

  async toggleActivo(id: string, activo: boolean): Promise<void> {
    const { error } = await this.supabase.client
      .from('bodegas')
      .update({ activo })
      .eq('id', id);

    if (error) throw new Error(error.message);
  }

  /** Z9 — stock actual de un almacén (con nombre/código del artículo). */
  async getStock(bodegaId: string): Promise<{ articulo_id: string; cantidad: number; articulo: { nombre: string; codigo: string } | null }[]> {
    const { data, error } = await this.supabase.client
      .from('stock_por_bodega')
      .select('articulo_id, cantidad, articulo:articulos(nombre, codigo)')
      .eq('bodega_id', bodegaId)
      .gt('cantidad', 0)
      .order('cantidad', { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as { articulo_id: string; cantidad: number; articulo: { nombre: string; codigo: string } | null }[];
  }

  /** Z9 — últimos movimientos de un almacén. */
  async getMovimientos(bodegaId: string, limit = 15): Promise<{ tipo: string; fecha: string; concepto: string | null; items: number }[]> {
    const { data, error } = await this.supabase.client
      .from('v_movimientos_inventario')
      .select('tipo, fecha, concepto, items')
      .eq('bodega_id', bodegaId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as { tipo: string; fecha: string; concepto: string | null; items: number }[];
  }

  /** Z21 — IDs de proyecto que ya tienen al menos un almacén (activo o no). */
  async getProyectoIdsConAlmacen(): Promise<string[]> {
    const { data, error } = await this.supabase.client
      .from('bodegas')
      .select('proyecto_id')
      .not('proyecto_id', 'is', null);
    if (error) throw new Error(error.message);
    return [...new Set((data ?? []).map((r: { proyecto_id: string }) => r.proyecto_id))];
  }
}
