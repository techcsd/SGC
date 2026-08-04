import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';
import type { RealtimeChannel } from '@supabase/supabase-js';

export type ChoferEstado = 'disponible' | 'en_ruta' | 'descanso' | 'almuerzo' | 'inactivo' | 'otros';

export interface UltimaPosicion {
  usuario_id: string;
  vehiculo_id: string | null;
  lat: number;
  lng: number;
  precision_m: number | null;
  bateria: number | null;
  capturado_en: string;
  usuario?: { nombre: string } | null;
  vehiculo?: { placa: string } | null;
}

export interface ChoferEstadoRow {
  usuario_id: string;
  conductor_id: string;
  nombre: string;
  estado: ChoferEstado;
  otros_texto: string | null;
  almuerzo_inicio: string | null;
  desde: string | null;
  updated_at: string | null;
}

export interface RutaActiva {
  id: string;
  seccion: 'activa' | 'hoy';
  estado: string;
  tipo: string;
  origen: string;
  destino: string;
  placa: string | null;
  conductor_nombre: string | null;
  fecha: string;
  iniciada_at: string | null;
  paradas_total: number;
  paradas_entregadas: number;
}

/** AF27 — datos para la vista de Seguimiento (posiciones en vivo, estados, rutas). */
@Injectable({ providedIn: 'root' })
export class SeguimientoService {
  private supabase = inject(SupabaseService);

  async getPosiciones(): Promise<UltimaPosicion[]> {
    const { data, error } = await this.supabase.client
      .from('chofer_ultima_posicion')
      .select('*, usuario:usuarios(nombre), vehiculo:vehiculos(placa)');
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as UltimaPosicion[];
  }

  async getChoferesEstado(): Promise<ChoferEstadoRow[]> {
    const { data, error } = await this.supabase.client.rpc('choferes_estado');
    if (error) throw new Error(error.message);
    return (data ?? []) as ChoferEstadoRow[];
  }

  async getRutasActivas(): Promise<RutaActiva[]> {
    const { data, error } = await this.supabase.client.rpc('rutas_activas_y_hoy');
    if (error) throw new Error(error.message);
    return (data ?? []) as RutaActiva[];
  }

  /** Suscribe a cambios de última posición (realtime). Devuelve el canal para limpiar. */
  subscribePosiciones(onChange: (row: UltimaPosicion) => void): RealtimeChannel {
    const ch = this.supabase.client
      .channel('rt-seguimiento-posiciones')
      .on(
        'postgres_changes',
        { event: '*', schema: 'sgc', table: 'chofer_ultima_posicion' },
        (payload) => {
          const row = payload.new as UltimaPosicion;
          if (row && row.usuario_id) onChange(row);
        },
      )
      .subscribe();
    return ch;
  }

  removeChannel(ch: RealtimeChannel) {
    this.supabase.client.removeChannel(ch);
  }
}
