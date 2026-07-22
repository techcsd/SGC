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
  | 'vehiculo_danos';

/**
 * T2 — helper compartido para marcar/eliminar datos de prueba (solo admin).
 * El enforcement de visibilidad para no-admin es server-side (política RLS
 * restrictiva); aquí solo se exponen las acciones administrativas.
 */
@Injectable({ providedIn: 'root' })
export class DatosPruebaService {
  private supabase = inject(SupabaseService);

  /** Marca o desmarca un registro como dato de prueba. */
  async marcar(tabla: TablaPrueba, id: string, valor: boolean): Promise<void> {
    const { error } = await this.supabase.client.rpc('marcar_dato_prueba', {
      p_tabla: tabla,
      p_id: id,
      p_valor: valor,
    });
    if (error) throw new Error(error.message);
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
