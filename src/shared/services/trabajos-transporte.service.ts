import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';
import { NotificacionesService } from './notificaciones.service';

// CK15/CK16 — bandeja de trabajos de transporte (Misael) + panel "Mis choferes".
export type TrabajoOrigen = 'apoyo' | 'requisicion' | 'manual';

export interface TrabajoRow {
  origen: TrabajoOrigen;
  origen_id: string;
  tipo: string;
  descripcion: string | null;
  proyecto_id: string | null;
  proyecto: string | null;
  dia: string | null;
  estado: string;
  conductor_id: string | null;
  conductor: string | null;
  vehiculo_id: string | null;
  ruta_id: string | null;
  created_at: string;
}

export interface ChoferPanel {
  conductor_id: string;
  usuario_id: string | null;
  nombre: string;
  telefono: string | null;
  estado: string;
  estado_desde: string | null;
  trabajos_hoy: number;
  en_proceso: number;
  vehiculo_en_uso: string | null;
  ultima_senal: string | null;
  bateria: number | null;
}

@Injectable({ providedIn: 'root' })
export class TrabajosTransporteService {
  private supabase = inject(SupabaseService);
  private notificaciones = inject(NotificacionesService);

  async listar(f?: { dia?: string | null; estado?: string | null; conductorId?: string | null }): Promise<TrabajoRow[]> {
    const { data, error } = await this.supabase.client.rpc('trabajos_transporte_listado', {
      p_dia: f?.dia ?? null,
      p_estado: f?.estado ?? null,
      p_conductor_id: f?.conductorId ?? null,
    });
    if (error) throw new Error(error.message);
    return (data ?? []) as TrabajoRow[];
  }

  async choferesActivos(): Promise<{ id: string; nombre: string }[]> {
    const { data, error } = await this.supabase.client.rpc('choferes_activos');
    if (error) return [];
    return ((data ?? []) as { conductor_id: string; nombre: string }[]).map((c) => ({ id: c.conductor_id, nombre: c.nombre }));
  }

  async asignar(origen: TrabajoOrigen, origenId: string, conductorId: string, vehiculoId?: string | null, dia?: string | null): Promise<void> {
    const { error } = await this.supabase.client.rpc('trabajo_asignar', {
      p_origen: origen,
      p_origen_id: origenId,
      p_conductor_id: conductorId,
      p_vehiculo_id: vehiculoId ?? null,
      p_dia: dia ?? null,
    });
    if (error) throw new Error(error.message);
    this.notificaciones.refresh();
  }

  async crearActividad(descripcion: string, proyectoId?: string | null, dia?: string | null, conductorId?: string | null): Promise<string> {
    const { data, error } = await this.supabase.client.rpc('actividad_crear', {
      p_descripcion: descripcion,
      p_proyecto_id: proyectoId ?? null,
      p_dia: dia ?? null,
      p_conductor_id: conductorId ?? null,
    });
    if (error) throw new Error(error.message);
    this.notificaciones.refresh();
    return data as string;
  }

  async misChoferes(): Promise<ChoferPanel[]> {
    const { data, error } = await this.supabase.client.rpc('mis_choferes_panel');
    if (error) throw new Error(error.message);
    return (data ?? []) as ChoferPanel[];
  }
}
