import { Injectable, inject } from '@angular/core';
import { RealtimeChannel } from '@supabase/supabase-js';
import { SupabaseService } from '../../app/core/services/supabase.service';
import { Tarea, TareaComentario, TareaEstado } from '../models/tarea.model';

const TAREA_SELECT =
  '*, asignado:usuarios!tareas_asignado_a_fkey(nombre), asignador:usuarios!tareas_asignado_por_fkey(nombre), proyecto:proyectos(nombre, latitud, longitud)';

export interface DirectorioUsuario {
  id: string;
  nombre: string;
}

@Injectable({ providedIn: 'root' })
export class TareasService {
  private supabase = inject(SupabaseService);

  /** Minimal active-user list for the assignee picker (SECURITY DEFINER RPC). */
  async getDirectorio(): Promise<DirectorioUsuario[]> {
    const { data, error } = await this.supabase.client.rpc('directorio_usuarios');
    if (error) throw new Error(error.message);
    return (data ?? []) as DirectorioUsuario[];
  }

  /** All tasks the caller can see (managers see everything; others see their own). */
  async getAll(): Promise<Tarea[]> {
    const { data, error } = await this.supabase.client
      .from('tareas')
      .select(TAREA_SELECT)
      .order('created_at', { ascending: false });

    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as Tarea[];
  }

  /** Tasks assigned to a specific user (for "Mis tareas"). */
  async getAsignadasA(usuarioId: string): Promise<Tarea[]> {
    const { data, error } = await this.supabase.client
      .from('tareas')
      .select(TAREA_SELECT)
      .eq('asignado_a', usuarioId)
      .order('created_at', { ascending: false });

    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as Tarea[];
  }

  async create(payload: {
    titulo: string;
    descripcion: string | null;
    prioridad: string;
    asignadoA: string;
    asignadoPor: string;
    proyectoId: string | null;
    fechaLimite: string | null;
  }): Promise<Tarea> {
    const { data, error } = await this.supabase.client
      .from('tareas')
      .insert({
        titulo: payload.titulo,
        descripcion: payload.descripcion,
        prioridad: payload.prioridad,
        asignado_a: payload.asignadoA,
        asignado_por: payload.asignadoPor,
        proyecto_id: payload.proyectoId,
        fecha_limite: payload.fechaLimite,
      })
      .select(TAREA_SELECT)
      .single();

    if (error) throw new Error(error.message);
    return data as unknown as Tarea;
  }

  async update(id: string, payload: Partial<Tarea>): Promise<Tarea> {
    const { data, error } = await this.supabase.client
      .from('tareas')
      .update(payload)
      .eq('id', id)
      .select(TAREA_SELECT)
      .single();

    if (error) throw new Error(error.message);
    return data as unknown as Tarea;
  }

  async cambiarEstado(id: string, estado: TareaEstado): Promise<Tarea> {
    const payload: Partial<Tarea> = { estado };
    payload.fecha_completada = estado === 'completada' ? new Date().toISOString() : null;
    return this.update(id, payload);
  }

  async remove(id: string): Promise<void> {
    const { error } = await this.supabase.client.from('tareas').delete().eq('id', id);
    if (error) throw new Error(error.message);
  }

  async getComentarios(tareaId: string): Promise<TareaComentario[]> {
    const { data, error } = await this.supabase.client
      .from('tarea_comentarios')
      .select('*, usuario:usuarios(nombre)')
      .eq('tarea_id', tareaId)
      .order('created_at', { ascending: true });

    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as TareaComentario[];
  }

  async addComentario(tareaId: string, usuarioId: string, comentario: string): Promise<TareaComentario> {
    const { data, error } = await this.supabase.client
      .from('tarea_comentarios')
      .insert({ tarea_id: tareaId, usuario_id: usuarioId, comentario })
      .select('*, usuario:usuarios(nombre)')
      .single();

    if (error) throw new Error(error.message);
    return data as unknown as TareaComentario;
  }

  /** Live task changes (INSERT/UPDATE/DELETE) the caller can see — RLS-scoped.
   *  Lets the Tareas views reflect state changes without a page refresh. */
  subscribeTareas(onChange: () => void): RealtimeChannel {
    return this.supabase.client
      .channel('tareas-feed')
      .on('postgres_changes', { event: '*', schema: 'sgc', table: 'tareas' }, () => onChange())
      .subscribe();
  }

  async unsubscribe(channel: RealtimeChannel): Promise<void> {
    await this.supabase.client.removeChannel(channel);
  }

  /** Count of open (pendiente/en_progreso) tasks assigned to a user — for the nav badge. */
  async countPendientesAsignadas(usuarioId: string): Promise<number> {
    const { count, error } = await this.supabase.client
      .from('tareas')
      .select('id', { count: 'exact', head: true })
      .eq('asignado_a', usuarioId)
      .in('estado', ['pendiente', 'en_progreso']);
    if (error) throw new Error(error.message);
    return count ?? 0;
  }
}
