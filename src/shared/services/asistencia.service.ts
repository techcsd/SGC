import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';
import { Asistencia, AsistenciaFormData } from '../models/asistencia.model';

@Injectable({ providedIn: 'root' })
export class AsistenciaService {
  private supabase = inject(SupabaseService);

  async getByFecha(fecha: string): Promise<Asistencia[]> {
    const { data, error } = await this.supabase.client
      .from('asistencia')
      .select('*, empleado:empleados(nombre, apellido, cargo)')
      .eq('fecha', fecha)
      .order('created_at');

    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as Asistencia[];
  }

  async getByEmpleado(empleadoId: string): Promise<Asistencia[]> {
    const { data, error } = await this.supabase.client
      .from('asistencia')
      .select('*, empleado:empleados(nombre, apellido, cargo)')
      .eq('empleado_id', empleadoId)
      .order('fecha', { ascending: false })
      .limit(30);

    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as Asistencia[];
  }

  async upsert(payload: AsistenciaFormData): Promise<Asistencia> {
    const { data, error } = await this.supabase.client
      .from('asistencia')
      .upsert(payload, { onConflict: 'empleado_id,fecha' })
      .select('*, empleado:empleados(nombre, apellido, cargo)')
      .single();

    if (error) throw new Error(error.message);
    return data as unknown as Asistencia;
  }
}
