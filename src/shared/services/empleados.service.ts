import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';
import { Empleado, EmpleadoFormData } from '../models/empleado.model';

@Injectable({ providedIn: 'root' })
export class EmpleadosService {
  private supabase = inject(SupabaseService);

  async getAll(): Promise<Empleado[]> {
    const { data, error } = await this.supabase.client
      .from('empleados')
      .select('*')
      .order('apellido')
      .order('nombre');

    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as Empleado[];
  }

  async create(payload: EmpleadoFormData): Promise<Empleado> {
    const { data, error } = await this.supabase.client
      .from('empleados')
      .insert(payload)
      .select('*')
      .single();

    if (error) throw new Error(error.message);
    return data as unknown as Empleado;
  }

  async update(id: string, payload: Partial<EmpleadoFormData>): Promise<Empleado> {
    const { data, error } = await this.supabase.client
      .from('empleados')
      .update({ ...payload, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('*')
      .single();

    if (error) throw new Error(error.message);
    return data as unknown as Empleado;
  }

  async toggleActivo(id: string, activo: boolean): Promise<void> {
    const { error } = await this.supabase.client
      .from('empleados')
      .update({ activo, updated_at: new Date().toISOString() })
      .eq('id', id);

    if (error) throw new Error(error.message);
  }
}
