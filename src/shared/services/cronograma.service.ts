import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';
import { CronogramaData, CronogramaTarea, CronogramaTipo } from '../models/cronograma.model';

const BUCKET = 'sgc-cronograma';

/**
 * Y15 — Cronograma de Proyectos. Toda escritura pasa por RPCs SECURITY DEFINER
 * (validación + auto-ajuste + historial server-side, aptos para outbox en la app).
 */
@Injectable({ providedIn: 'root' })
export class CronogramaService {
  private supabase = inject(SupabaseService);

  async listar(proyectoId: string): Promise<CronogramaData> {
    const { data, error } = await this.supabase.client.rpc('listar_cronograma', {
      p_proyecto_id: proyectoId,
    });
    if (error) throw new Error(error.message);
    const d = (data ?? { tareas: [], recalculos: [] }) as CronogramaData;
    return { tareas: d.tareas ?? [], recalculos: d.recalculos ?? [] };
  }

  async crearTarea(input: {
    proyectoId: string;
    nombre: string;
    tipo: CronogramaTipo;
    duracionDias: number;
    orden?: number | null;
    faseId?: string | null;
    descripcion?: string | null;
    fechaInicioPlan?: string | null;
    esPrueba?: boolean;
    id?: string | null;
  }): Promise<string> {
    const { data, error } = await this.supabase.client.rpc('crear_tarea_cronograma', {
      p_proyecto_id: input.proyectoId,
      p_nombre: input.nombre,
      p_tipo: input.tipo,
      p_duracion_dias_plan: input.duracionDias,
      p_orden: input.orden ?? null,
      p_fase_id: input.faseId ?? null,
      p_descripcion: input.descripcion ?? null,
      p_fecha_inicio_plan: input.fechaInicioPlan ?? null,
      p_es_prueba: input.esPrueba ?? false,
      p_id: input.id ?? null,
    });
    if (error) throw new Error(error.message);
    return data as string;
  }

  async iniciar(tareaId: string, fechaInicio?: string | null): Promise<void> {
    const { error } = await this.supabase.client.rpc('iniciar_tarea', {
      p_tarea_id: tareaId,
      p_fecha_inicio: fechaInicio ?? null,
    });
    if (error) throw new Error(error.message);
  }

  async completar(
    tareaId: string,
    fotoPath: string,
    justificacion?: string | null,
    fechaFin?: string | null,
  ): Promise<void> {
    const { error } = await this.supabase.client.rpc('completar_tarea', {
      p_tarea_id: tareaId,
      p_foto_path: fotoPath,
      p_justificacion: justificacion ?? null,
      p_fecha_fin: fechaFin ?? null,
    });
    if (error) throw new Error(error.message);
  }

  async justificarRetraso(tareaId: string, justificacion: string): Promise<void> {
    const { error } = await this.supabase.client.rpc('justificar_retraso', {
      p_tarea_id: tareaId,
      p_justificacion: justificacion,
    });
    if (error) throw new Error(error.message);
  }

  async enlazarBitacora(
    tareaId: string,
    bitacoraId: string,
    completar = false,
    fotoPath: string | null = null,
  ): Promise<void> {
    const { error } = await this.supabase.client.rpc('enlazar_bitacora_tarea', {
      p_tarea_id: tareaId,
      p_bitacora_id: bitacoraId,
      p_completar: completar,
      p_foto_path: fotoPath,
    });
    if (error) throw new Error(error.message);
  }

  /** Edición directa de campos no controlados por el ciclo de vida (nombre, tipo, duración, orden).
   *  El recálculo se dispara re-guardando; para simplicidad usamos update directo + RPC de recálculo. */
  async actualizarTarea(
    tareaId: string,
    proyectoId: string,
    patch: Partial<Pick<CronogramaTarea, 'nombre' | 'descripcion' | 'tipo' | 'orden' | 'duracion_dias_plan'>>,
  ): Promise<void> {
    const { error } = await this.supabase.client
      .from('cronograma_tareas')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', tareaId);
    if (error) throw new Error(error.message);
    const { error: rErr } = await this.supabase.client.rpc('recalcular_cronograma', {
      p_proyecto_id: proyectoId,
    });
    if (rErr) throw new Error(rErr.message);
  }

  async eliminarTarea(tareaId: string, proyectoId: string): Promise<void> {
    const { error } = await this.supabase.client
      .from('cronograma_tareas')
      .delete()
      .eq('id', tareaId);
    if (error) throw new Error(error.message);
    await this.supabase.client.rpc('recalcular_cronograma', { p_proyecto_id: proyectoId });
  }

  /** Sube la foto de evidencia y devuelve el storage path (para pasarlo a completar()). */
  async subirEvidencia(tareaId: string, file: File): Promise<string> {
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
    const path = `${tareaId}/${crypto.randomUUID()}.${ext}`;
    const { error } = await this.supabase.client.storage.from(BUCKET).upload(path, file);
    if (error) throw new Error(error.message);
    return path;
  }

  async getEvidenciaUrl(path: string): Promise<string | null> {
    const { data, error } = await this.supabase.client.storage
      .from(BUCKET)
      .createSignedUrl(path, 3600);
    if (error) return null;
    return data.signedUrl;
  }
}
