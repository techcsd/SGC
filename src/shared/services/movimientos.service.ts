import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';

/** Fila de la vista sgc.v_movimientos_inventario (entradas + salidas). */
export interface MovimientoInventario {
  referencia_id: string;
  tipo: 'salida' | 'entrada';
  fecha: string;
  created_at: string;
  bodega_id: string;
  concepto: string | null;
  responsable: string | null;
  proyecto_id: string | null;
  items: number;
  creado_por: string | null;
}

/** U16 — Historial/actividad de movimientos de inventario (global y por almacén). */
@Injectable({ providedIn: 'root' })
export class MovimientosService {
  private supabase = inject(SupabaseService);

  async getMovimientos(): Promise<MovimientoInventario[]> {
    const { data, error } = await this.supabase.client
      .from('v_movimientos_inventario')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(500);
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as MovimientoInventario[];
  }
}
