import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';
import { Conductor, ConductorFormData } from '../models/conductor.model';

@Injectable({ providedIn: 'root' })
export class ConductoresService {
  private supabase = inject(SupabaseService);

  async getAll(): Promise<Conductor[]> {
    const { data, error } = await this.supabase.client
      .from('conductores')
      .select('*')
      .order('nombre');

    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as Conductor[];
  }

  async create(payload: ConductorFormData): Promise<Conductor> {
    const { data, error } = await this.supabase.client
      .from('conductores')
      .insert(payload)
      .select('*')
      .single();

    if (error) throw new Error(error.message);
    return data as unknown as Conductor;
  }

  async update(id: string, payload: Partial<ConductorFormData>): Promise<Conductor> {
    const { data, error } = await this.supabase.client
      .from('conductores')
      .update({ ...payload, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('*')
      .single();

    if (error) throw new Error(error.message);
    return data as unknown as Conductor;
  }

  async toggleActivo(id: string, activo: boolean): Promise<void> {
    const { error } = await this.supabase.client
      .from('conductores')
      .update({ activo, updated_at: new Date().toISOString() })
      .eq('id', id);

    if (error) throw new Error(error.message);
  }
}
