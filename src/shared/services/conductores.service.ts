import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';
import { Conductor, ConductorFormData } from '../models/conductor.model';

@Injectable({ providedIn: 'root' })
export class ConductoresService {
  private supabase = inject(SupabaseService);

  async getAll(): Promise<Conductor[]> {
    const { data, error } = await this.supabase.client
      .from('conductores')
      .select('*, vehiculo:vehiculos(placa, marca, modelo), usuario:usuarios(nombre)')
      .order('nombre');

    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as Conductor[];
  }

  async create(payload: ConductorFormData): Promise<Conductor> {
    const { data, error } = await this.supabase.client
      .from('conductores')
      .insert(payload)
      .select('*, vehiculo:vehiculos(placa, marca, modelo), usuario:usuarios(nombre)')
      .single();

    if (error) throw new Error(error.message);
    return data as unknown as Conductor;
  }

  async update(id: string, payload: Partial<ConductorFormData>): Promise<Conductor> {
    const { data, error } = await this.supabase.client
      .from('conductores')
      .update({ ...payload, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('*, vehiculo:vehiculos(placa, marca, modelo), usuario:usuarios(nombre)')
      .single();

    if (error) throw new Error(error.message);
    return data as unknown as Conductor;
  }

  /** Active app users, for linking a driver to their CSD App account. */
  async getUsuariosVinculables(): Promise<{ id: string; nombre: string }[]> {
    const { data, error } = await this.supabase.client
      .from('usuarios')
      .select('id, nombre')
      .eq('activo', true)
      .order('nombre');

    if (error) throw new Error(error.message);
    return (data ?? []) as { id: string; nombre: string }[];
  }

  async toggleActivo(id: string, activo: boolean): Promise<void> {
    const { error } = await this.supabase.client
      .from('conductores')
      .update({ activo, updated_at: new Date().toISOString() })
      .eq('id', id);

    if (error) throw new Error(error.message);
  }
}
