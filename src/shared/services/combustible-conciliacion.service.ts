import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';

/** Cabecera guardada de una conciliación (para historial/dashboard). */
export interface ConciliacionRegistro {
  id: string;
  estacion: string;
  fecha_desde: string | null;
  fecha_hasta: string | null;
  nombre_archivo: string | null;
  total_informe_filas: number;
  total_matches: number;
  total_solo_plataforma: number;
  total_solo_informe: number;
  total_diferencias: number;
  monto_plataforma: number;
  monto_informe: number;
  galones_plataforma: number;
  galones_informe: number;
  notas: string | null;
  created_at: string;
}

export interface ConciliacionMeta {
  estacion: string;
  fecha_desde: string | null;
  fecha_hasta: string | null;
  nombre_archivo: string | null;
  total_informe_filas: number;
  total_matches: number;
  total_solo_plataforma: number;
  total_solo_informe: number;
  total_diferencias: number;
  monto_plataforma: number;
  monto_informe: number;
  galones_plataforma: number;
  galones_informe: number;
  notas: string | null;
}

export interface ConciliacionDetalle {
  tipo: 'match' | 'diferencia' | 'solo_plataforma' | 'solo_informe';
  registro_id: string | null;
  vehiculo_id: string | null;
  identificador: string | null;
  fecha: string | null;
  galones_plataforma: number | null;
  galones_informe: number | null;
  monto_plataforma: number | null;
  monto_informe: number | null;
  diferencia_galones: number | null;
  diferencia_monto: number | null;
}

/** T4 — conciliación de combustible: registros de la plataforma + persistencia. */
@Injectable({ providedIn: 'root' })
export class CombustibleConciliacionService {
  private supabase = inject(SupabaseService);

  /** Registros de combustible en el rango de fechas (para el matching). */
  async getRegistrosEnRango(desde: string | null, hasta: string | null) {
    let q = this.supabase.client
      .from('registros_combustible')
      .select('id, vehiculo_id, fecha, galones, monto, estacion, vehiculo:vehiculos(placa)');
    if (desde) q = q.gte('fecha', desde);
    if (hasta) q = q.lte('fecha', hasta);
    const { data, error } = await q.order('fecha', { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as {
      id: string;
      vehiculo_id: string;
      fecha: string;
      galones: number | null;
      monto: number | null;
      estacion: string | null;
      vehiculo?: { placa: string } | null;
    }[];
  }

  async guardar(meta: ConciliacionMeta, detalles: ConciliacionDetalle[]): Promise<string> {
    const { data, error } = await this.supabase.client.rpc('guardar_conciliacion_combustible', {
      p_meta: meta,
      p_detalles: detalles,
    });
    if (error) throw new Error(error.message);
    return data as string;
  }

  async getHistorial(): Promise<ConciliacionRegistro[]> {
    const { data, error } = await this.supabase.client
      .from('conciliaciones_combustible')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as ConciliacionRegistro[];
  }

  async getDetalle(conciliacionId: string): Promise<ConciliacionDetalle[]> {
    const { data, error } = await this.supabase.client
      .from('conciliacion_combustible_detalle')
      .select('*')
      .eq('conciliacion_id', conciliacionId);
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as ConciliacionDetalle[];
  }
}
