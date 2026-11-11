import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';
import { RrhhEvaluacion } from '../models/rrhh-evaluacion.model';

/** DN-27 P2 — Evaluaciones de desempeño. SENSIBLE: toda lectura pasa por la
 *  RPC auditada (sgc.rrhh_evaluaciones_de_empleado), nunca SELECT directo. */
@Injectable({ providedIn: 'root' })
export class RrhhEvaluacionesService {
  private supabase = inject(SupabaseService);

  async evaluacionesDeEmpleado(empleadoId: string): Promise<RrhhEvaluacion[]> {
    const { data, error } = await this.supabase.client.rpc('rrhh_evaluaciones_de_empleado', { p_empleado_id: empleadoId });
    if (error) throw new Error(error.message);
    return (data ?? []) as RrhhEvaluacion[];
  }

  async crearEvaluacion(empleadoId: string, periodo: string, puntaje: number | null, comentarios: string | null): Promise<void> {
    const { error } = await this.supabase.client.rpc('rrhh_crear_evaluacion', {
      p_empleado_id: empleadoId, p_periodo: periodo, p_puntaje: puntaje, p_comentarios: comentarios,
    });
    if (error) throw new Error(error.message);
  }
}
