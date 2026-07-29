import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';

/** Tablas operativas que admiten marcado/eliminación como dato de prueba (T2). */
export type TablaPrueba =
  | 'vehiculos'
  | 'conductores'
  | 'bitacoras'
  | 'checklists_vehiculo'
  | 'registros_combustible'
  | 'vehiculo_entregas'
  | 'mantenimientos'
  | 'rutas'
  | 'entradas_inventario'
  | 'salidas_inventario'
  | 'vehiculo_accidentes'
  | 'conductor_multas'
  | 'vehiculo_danos'
  // Z5(d) — entidades nuevas soportadas por la whitelist server-side
  // (marcar_prueba_cascada / eliminar_dato_prueba).
  | 'proyectos'
  | 'bodegas'
  | 'empleados'
  | 'proveedores'
  | 'articulos'
  | 'activos_fijos'
  | 'conteos_inventario'
  | 'ordenes_compra';

/**
 * T2 — helper compartido para marcar/eliminar datos de prueba (solo admin).
 * El enforcement de visibilidad para no-admin es server-side (política RLS
 * restrictiva); aquí solo se exponen las acciones administrativas.
 */
@Injectable({ providedIn: 'root' })
export class DatosPruebaService {
  private supabase = inject(SupabaseService);

  /**
   * Marca o desmarca un registro como dato de prueba. Si es un padre
   * (vehículo/conductor), la cascada a los derivados existentes la hace el
   * servidor (X14). Devuelve cuántos derivados se marcaron/revirtieron.
   */
  async marcar(tabla: TablaPrueba, id: string, valor: boolean): Promise<number> {
    const { data, error } = await this.supabase.client.rpc('marcar_prueba_cascada', {
      p_tabla: tabla,
      p_id: id,
      p_valor: valor,
    });
    if (error) throw new Error(error.message);
    return (data as number) ?? 0;
  }

  /**
   * AA21b — marca/desmarca un MOVIMIENTO de inventario (entrada/salida) como prueba
   * ajustando el stock (revierte al marcar test, re-aplica al volver a real). Usar
   * para entradas/salidas en vez de `marcar` para que el stock quede consistente.
   */
  async marcarMovimiento(
    tabla: 'entradas_inventario' | 'salidas_inventario',
    id: string,
    valor: boolean,
  ): Promise<void> {
    const { error } = await this.supabase.client.rpc('marcar_movimiento_inventario_prueba', {
      p_tabla: tabla,
      p_id: id,
      p_valor: valor,
    });
    if (error) throw new Error(error.message);
  }

  /**
   * X14 — cuántos registros derivados se verían afectados al marcar/desmarcar
   * este padre (para avisar "Esto marcará también N registros relacionados").
   */
  async contarDerivados(tabla: TablaPrueba, id: string, valor: boolean): Promise<number> {
    const { data, error } = await this.supabase.client.rpc('contar_derivados_prueba', {
      p_tabla: tabla,
      p_id: id,
      p_valor: valor,
    });
    if (error) return 0;
    return (data as number) ?? 0;
  }

  /** Elimina un registro marcado como prueba (con sus hijos por FK cascade). */
  async eliminar(tabla: TablaPrueba, id: string): Promise<void> {
    const { error } = await this.supabase.client.rpc('eliminar_dato_prueba', {
      p_tabla: tabla,
      p_id: id,
    });
    if (error) throw new Error(error.message);
  }
}
