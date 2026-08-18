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
  vehiculo?: { placa: string | null; marca?: string | null; modelo?: string | null; color?: string | null } | null;
}

/** AT1 — un tramo del recorrido diario (segmento continuo entre huecos). */
export interface RecorridoTramo {
  inicio_at: string;
  fin_at: string;
  km: number;
  coords: [number, number][];
}

/** AU7 — una parada/visita detectada en el recorrido diario (estilo Google Timeline). */
export interface RecorridoParada {
  inicio_at: string;
  fin_at: string;
  lat: number;
  lng: number;
  minutos: number;
}

/** AT1 — recorrido diario tipo Timeline (RPC recorrido_diario_de). */
export interface RecorridoDiario {
  usuario_id: string;
  nombre: string | null;
  fecha: string;
  coords: [number, number][];
  polyline: string | null;
  tramos: RecorridoTramo[];
  paradas: RecorridoParada[];
  puntos: number;
  km: number | null;
  primer_at: string | null;
  ultimo_at: string | null;
  fuente: 'consolidado' | 'vivo';
}

/** AT1 — una fila del directorio de recorridos disponibles (RPC recorridos_disponibles). */
export interface RecorridoDisponible {
  usuario_id: string;
  nombre: string;
  fecha: string;
  puntos: number;
  km: number | null;
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
  marca: string | null;
  modelo: string | null;
  color: string | null;
  conductor_nombre: string | null;
  fecha: string;
  iniciada_at: string | null;
  paradas_total: number;
  paradas_entregadas: number;
}

export interface RutaTrayecto {
  ruta_id?: string;
  polyline?: string | null;
  coords: [number, number][];
  puntos: number;
  km?: number | null;
  consolidado_at?: string | null;
}

/** AP6 — una fila del histórico de rutas por chofer (RPC rutas_historial). */
export interface RutaHistorialRow {
  id: string;
  estado: string;
  tipo: string | null;
  origen: string | null;
  destino: string | null;
  destino_proyecto_id: string | null;
  obra: string | null;
  placa: string | null;
  conductor_id: string | null;
  conductor_nombre: string | null;
  fecha: string;
  iniciada_at: string | null;
  finalizada_at: string | null;
  km_real: number | null;
  km_estimado: number | null;
  duracion_min: number | null;
  paradas_total: number | null;
  paradas_entregadas: number | null;
}

/** AS1 — diagnóstico del pipeline de tracking por chofer (RPC tracking_diagnostico). */
export interface TrackingDiagnosticoRow {
  usuario_id: string;
  usuario_nombre: string | null;
  batches: number;
  recibidos: number;
  insertados: number;
  desc_precision: number;
  desc_salto: number;
  desc_sin_coord: number;
  ultima_ingesta: string | null;
  ultima_posicion: string | null;
  minutos_desde_posicion: number | null;
}

/** AF27 — datos para la vista de Seguimiento (posiciones en vivo, estados, rutas). */
@Injectable({ providedIn: 'root' })
export class SeguimientoService {
  private supabase = inject(SupabaseService);

  /** AP6/AS1 — histórico de rutas por chofer (RPC SECURITY DEFINER: no lo oculta
   *  la RLS de scope como rutas.getAll()). Corrige el "histórico vacío". */
  async getRutasHistorial(f?: {
    conductor?: string | null;
    desde?: string | null;
    hasta?: string | null;
    obra?: string | null;
    estado?: string | null;
    limite?: number | null;
  }): Promise<RutaHistorialRow[]> {
    const { data, error } = await this.supabase.client.rpc('rutas_historial', {
      p_conductor: f?.conductor ?? null,
      p_desde: f?.desde ?? null,
      p_hasta: f?.hasta ?? null,
      p_obra: f?.obra ?? null,
      p_estado: f?.estado ?? null,
      p_limite: f?.limite ?? 500,
    });
    if (error) throw new Error(error.message);
    return (data ?? []) as RutaHistorialRow[];
  }

  /** AS1 — diagnóstico del pipeline de tracking (contadores AK13 + edad de la
   *  última posición). Roles elevados/tecnología (gate en el RPC). */
  async getTrackingDiagnostico(desde?: string | null): Promise<TrackingDiagnosticoRow[]> {
    const { data, error } = await this.supabase.client.rpc('tracking_diagnostico', {
      p_desde: desde ?? null,
    });
    if (error) throw new Error(error.message);
    return (data ?? []) as TrackingDiagnosticoRow[];
  }

  /** AT4 — SOLO posiciones de quienes comparten ubicación (RPC blindada server-side,
   *  reemplaza el .from directo que colaba a no-sharers como Xaviel/Eduardo). */
  async getPosiciones(): Promise<UltimaPosicion[]> {
    const { data, error } = await this.supabase.client.rpc('ultimas_posiciones');
    if (error) throw new Error(error.message);
    return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
      usuario_id: r['usuario_id'] as string,
      vehiculo_id: (r['vehiculo_id'] as string) ?? null,
      lat: r['lat'] as number,
      lng: r['lng'] as number,
      precision_m: (r['precision_m'] as number) ?? null,
      bateria: (r['bateria'] as number) ?? null,
      capturado_en: r['capturado_en'] as string,
      usuario: { nombre: (r['nombre'] as string) ?? '' },
      vehiculo: r['vehiculo_id']
        ? {
            placa: (r['placa'] as string) ?? null,
            marca: (r['marca'] as string) ?? null,
            modelo: (r['modelo'] as string) ?? null,
            color: (r['color'] as string) ?? null,
          }
        : null,
    }));
  }

  /** AT1 — recorrido diario de un chofer en una fecha (tipo Google Timeline). */
  async getRecorridoDiario(usuarioId: string, fecha: string): Promise<RecorridoDiario | null> {
    const { data, error } = await this.supabase.client.rpc('recorrido_diario_de', {
      p_usuario_id: usuarioId,
      p_fecha: fecha,
    });
    if (error) throw new Error(error.message);
    return (data ?? null) as RecorridoDiario | null;
  }

  /** AT1 — qué choferes tienen recorrido en un rango de fechas (para el selector). */
  async getRecorridosDisponibles(desde: string, hasta: string): Promise<RecorridoDisponible[]> {
    const { data, error } = await this.supabase.client.rpc('recorridos_disponibles', {
      p_desde: desde,
      p_hasta: hasta,
    });
    if (error) throw new Error(error.message);
    return (data ?? []) as RecorridoDisponible[];
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

  /** AJ14 — breadcrumb en vivo de una ruta activa: [[lat,lng],...]. */
  async getRutaBreadcrumb(rutaId: string): Promise<[number, number][]> {
    const { data, error } = await this.supabase.client.rpc('ruta_breadcrumb_vivo', { p_ruta_id: rutaId });
    if (error) throw new Error(error.message);
    return (data ?? []) as [number, number][];
  }

  /** AJ14 — trayecto consolidado de una ruta finalizada (replay). */
  async getRutaTrayecto(rutaId: string): Promise<RutaTrayecto> {
    const { data, error } = await this.supabase.client.rpc('ruta_trayecto', { p_ruta_id: rutaId });
    if (error) throw new Error(error.message);
    return (data ?? { coords: [], puntos: 0 }) as RutaTrayecto;
  }

  /** AU7 — geocodificación inversa (lat/lng → dirección) para nombrar una parada.
   *  Server-side (edge function con la key de Google + caché). Best-effort. */
  async reverseGeocode(lat: number, lng: number): Promise<string | null> {
    try {
      const { data, error } = await this.supabase.client.functions.invoke('reverse-geocode', {
        body: { lat, lng },
      });
      if (error) return null;
      return (data?.direccion as string) ?? null;
    } catch {
      return null;
    }
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
