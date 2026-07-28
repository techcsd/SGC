import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';

export interface ProyectoEstructura {
  id: string;
  proyecto_id: string;
  nombre: string;
  orden: number;
  activa: boolean;
  created_at: string;
}

/** Z14 — estructuras (bloques/pisos/edificios) definidas por cada obra. */
@Injectable({ providedIn: 'root' })
export class ProyectoEstructurasService {
  private supabase = inject(SupabaseService);

  async getByProyecto(proyectoId: string): Promise<ProyectoEstructura[]> {
    const { data, error } = await this.supabase.client
      .from('proyecto_estructuras')
      .select('*')
      .eq('proyecto_id', proyectoId)
      .order('orden');
    if (error) throw new Error(error.message);
    return (data ?? []) as ProyectoEstructura[];
  }

  /** Nombres activos de las estructuras de una obra (para selectores). */
  async getNombres(proyectoId: string): Promise<string[]> {
    const rows = await this.getByProyecto(proyectoId);
    return rows.filter((e) => e.activa).map((e) => e.nombre);
  }

  async crear(proyectoId: string, nombre: string, orden: number): Promise<ProyectoEstructura> {
    const { data, error } = await this.supabase.client
      .from('proyecto_estructuras')
      .insert({ proyecto_id: proyectoId, nombre, orden })
      .select('*')
      .single();
    if (error) throw new Error(error.message);
    return data as ProyectoEstructura;
  }

  async eliminar(id: string): Promise<void> {
    const { error } = await this.supabase.client.from('proyecto_estructuras').delete().eq('id', id);
    if (error) throw new Error(error.message);
  }

  async toggleActiva(id: string, activa: boolean): Promise<void> {
    const { error } = await this.supabase.client
      .from('proyecto_estructuras')
      .update({ activa })
      .eq('id', id);
    if (error) throw new Error(error.message);
  }
}
