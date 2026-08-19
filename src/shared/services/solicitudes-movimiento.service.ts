import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';
import { NotificacionesService } from './notificaciones.service';

export type PrioridadMovimiento = 'baja' | 'media' | 'alta' | 'urgente';
export type EstadoMovimiento = 'pendiente' | 'planificada' | 'en_curso' | 'completada' | 'cancelada';

export interface SolicitudMovimiento {
  id: string;
  solicitante: string | null;
  proyecto_id: string | null;
  proyecto: string | null;
  que_se_mueve: string;
  tipo_carga: string;
  origen: string;
  destino: string;
  prioridad: PrioridadMovimiento;
  estado: EstadoMovimiento;
  fecha_solicitud: string;
  fecha_requerimiento: string | null;
  notas: string | null;
  ruta_id: string | null;
  conductor: string | null;
  es_prueba: boolean;
  dias_para_requerimiento: number | null;
  created_at: string;
}

export interface CrearSolicitudMovimiento {
  proyecto_id: string | null;
  que_se_mueve: string;
  tipo_carga: string;
  origen_tipo: string;
  origen_texto: string | null;
  destino_tipo: string;
  destino_texto: string | null;
  destino_proyecto_id: string | null;
  prioridad: PrioridadMovimiento;
  fecha_requerimiento: string | null;
  notas: string | null;
}

export interface ChoferCercano {
  usuario_id: string;
  nombre: string;
  vehiculo: string | null;
  lat: number;
  lng: number;
  distancia_km: number;
  actualizado: string;
}

@Injectable({ providedIn: 'root' })
export class SolicitudesMovimientoService {
  private supabase = inject(SupabaseService);
  private notificaciones = inject(NotificacionesService);

  async listar(filtros?: {
    estado?: string | null;
    proyectoId?: string | null;
    prioridad?: string | null;
    desde?: string | null;
    hasta?: string | null;
  }): Promise<SolicitudMovimiento[]> {
    const { data, error } = await this.supabase.client.rpc('solicitudes_movimiento_listar', {
      p_estado: filtros?.estado ?? null,
      p_proyecto_id: filtros?.proyectoId ?? null,
      p_prioridad: filtros?.prioridad ?? null,
      p_desde: filtros?.desde ?? null,
      p_hasta: filtros?.hasta ?? null,
    });
    if (error) throw new Error(error.message);
    return (data ?? []) as SolicitudMovimiento[];
  }

  async crear(s: CrearSolicitudMovimiento): Promise<string> {
    const { data, error } = await this.supabase.client.rpc('crear_solicitud_movimiento', {
      p_proyecto_id: s.proyecto_id,
      p_que_se_mueve: s.que_se_mueve,
      p_tipo_carga: s.tipo_carga,
      p_origen_tipo: s.origen_tipo,
      p_origen_texto: s.origen_texto,
      p_destino_tipo: s.destino_tipo,
      p_destino_texto: s.destino_texto,
      p_destino_proyecto_id: s.destino_proyecto_id,
      p_prioridad: s.prioridad,
      p_fecha_requerimiento: s.fecha_requerimiento,
      p_notas: s.notas,
    });
    if (error) throw new Error(error.message);
    this.notificaciones.refresh();
    return data as string;
  }

  async cancelar(id: string, motivo?: string): Promise<void> {
    const { error } = await this.supabase.client.rpc('cancelar_solicitud_movimiento', {
      p_id: id,
      p_motivo: motivo ?? null,
    });
    if (error) throw new Error(error.message);
    this.notificaciones.refresh();
  }

  async planificarConRuta(id: string, vehiculoId: string, conductorId: string, fecha?: string, notas?: string): Promise<string> {
    const { data, error } = await this.supabase.client.rpc('planificar_solicitud_con_ruta', {
      p_id: id,
      p_vehiculo_id: vehiculoId,
      p_conductor_id: conductorId,
      p_fecha: fecha ?? null,
      p_notas: notas ?? null,
    });
    if (error) throw new Error(error.message);
    this.notificaciones.refresh();
    return data as string;
  }

  async completar(id: string): Promise<void> {
    const { error } = await this.supabase.client.rpc('completar_solicitud_movimiento', { p_id: id });
    if (error) throw new Error(error.message);
    this.notificaciones.refresh();
  }

  /** Choferes cercanos a un punto (lat/lng) dentro de un radio (km). */
  async choferesCercanos(lat: number, lng: number, radioKm = 15): Promise<ChoferCercano[]> {
    const { data, error } = await this.supabase.client.rpc('solicitud_choferes_cercanos', {
      p_lat: lat,
      p_lng: lng,
      p_radio_km: radioKm,
    });
    if (error) throw new Error(error.message);
    return (data ?? []) as ChoferCercano[];
  }

  /** Choferes cercanos al punto de referencia de un proyecto (obra), si tiene coords. */
  async choferesCercanosDeProyecto(proyectoId: string, radioKm = 15): Promise<ChoferCercano[]> {
    const { data: p, error: e } = await this.supabase.client
      .from('proyectos')
      .select('latitud, longitud')
      .eq('id', proyectoId)
      .maybeSingle();
    if (e || !p) return [];
    const lat = (p as { latitud: number | null }).latitud;
    const lng = (p as { longitud: number | null }).longitud;
    if (lat == null || lng == null) return [];
    return this.choferesCercanos(lat, lng, radioKm);
  }
}
