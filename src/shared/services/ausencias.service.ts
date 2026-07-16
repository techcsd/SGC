import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';
import { SolicitudAusencia } from '../models/ausencia.model';

const AUSENCIA_SELECT =
  '*, empleado:empleados(nombre, apellido), solicitante:usuarios!solicitudes_ausencia_solicitado_por_fkey(nombre), aprobador:usuarios!solicitudes_ausencia_aprobado_por_fkey(nombre)';

@Injectable({ providedIn: 'root' })
export class AusenciasService {
  private supabase = inject(SupabaseService);

  async getAll(): Promise<SolicitudAusencia[]> {
    const { data, error } = await this.supabase.client
      .from('solicitudes_ausencia')
      .select(AUSENCIA_SELECT)
      .order('fecha_solicitud', { ascending: false });

    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as SolicitudAusencia[];
  }

  async create(payload: {
    empleadoId: string;
    tipo: string;
    fechaInicio: string;
    fechaFin: string;
    dias: number;
    motivo: string | null;
    solicitadoPor: string;
  }): Promise<SolicitudAusencia> {
    const { data, error } = await this.supabase.client
      .from('solicitudes_ausencia')
      .insert({
        empleado_id: payload.empleadoId,
        tipo: payload.tipo,
        fecha_inicio: payload.fechaInicio,
        fecha_fin: payload.fechaFin,
        dias: payload.dias,
        motivo: payload.motivo,
        solicitado_por: payload.solicitadoPor,
      })
      .select(AUSENCIA_SELECT)
      .single();

    if (error) throw new Error(error.message);
    return data as unknown as SolicitudAusencia;
  }

  async resolver(
    id: string,
    estado: 'aprobada' | 'rechazada',
    aprobadoPor: string,
    comentario: string | null,
  ): Promise<SolicitudAusencia> {
    const { data, error } = await this.supabase.client
      .from('solicitudes_ausencia')
      .update({
        estado,
        aprobado_por: aprobadoPor,
        comentario_aprobador: comentario,
        fecha_resolucion: new Date().toISOString(),
      })
      .eq('id', id)
      .select(AUSENCIA_SELECT)
      .single();

    if (error) throw new Error(error.message);
    return data as unknown as SolicitudAusencia;
  }

  async remove(id: string): Promise<void> {
    const { error } = await this.supabase.client.from('solicitudes_ausencia').delete().eq('id', id);
    if (error) throw new Error(error.message);
  }

  /** Approved vacation days taken by an employee in a given year (for balance). */
  async vacacionesTomadas(empleadoId: string, anio: number): Promise<number> {
    const { data, error } = await this.supabase.client
      .from('solicitudes_ausencia')
      .select('dias, fecha_inicio')
      .eq('empleado_id', empleadoId)
      .eq('tipo', 'vacaciones')
      .eq('estado', 'aprobada')
      .gte('fecha_inicio', `${anio}-01-01`)
      .lte('fecha_inicio', `${anio}-12-31`);

    if (error) throw new Error(error.message);
    return (data ?? []).reduce((sum, r) => sum + Number((r as { dias: number }).dias), 0);
  }

  /**
   * QA-032 — Genera los registros de asistencia (estado 'permiso') para cada día
   * de una ausencia aprobada. Idempotente en el lado del servidor (RPC).
   */
  async aplicarAsistencia(ausenciaId: string): Promise<void> {
    const { error } = await this.supabase.client.rpc('registrar_asistencia_por_ausencia', {
      p_ausencia_id: ausenciaId,
    });
    if (error) throw new Error(error.message);
  }

  async countPendientes(): Promise<number> {
    const { count, error } = await this.supabase.client
      .from('solicitudes_ausencia')
      .select('id', { count: 'exact', head: true })
      .eq('estado', 'pendiente');
    if (error) throw new Error(error.message);
    return count ?? 0;
  }
}

/** Working-day count (Mon–Fri, inclusive) between two YYYY-MM-DD dates. */
export function contarDiasLaborables(inicio: string, fin: string): number {
  const [y1, m1, d1] = inicio.split('-').map(Number);
  const [y2, m2, d2] = fin.split('-').map(Number);
  const start = new Date(y1, m1 - 1, d1);
  const end = new Date(y2, m2 - 1, d2);
  if (end < start) return 0;
  let count = 0;
  const cursor = new Date(start);
  while (cursor <= end) {
    const day = cursor.getDay();
    if (day !== 0 && day !== 6) count++;
    cursor.setDate(cursor.getDate() + 1);
  }
  return count;
}
