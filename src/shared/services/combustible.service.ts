import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';
import { RegistroCombustible, RegistroCombustibleFormData } from '../models/combustible.model';

@Injectable({ providedIn: 'root' })
export class CombustibleService {
  private supabase = inject(SupabaseService);

  async getAll(): Promise<RegistroCombustible[]> {
    const { data, error } = await this.supabase.client
      .from('registros_combustible')
      .select('*, vehiculo:vehiculos(placa,marca), conductor:conductores(nombre)')
      .order('fecha', { ascending: false });

    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as RegistroCombustible[];
  }

  async create(payload: RegistroCombustibleFormData): Promise<RegistroCombustible> {
    const { data, error } = await this.supabase.client
      .from('registros_combustible')
      .insert(payload)
      .select('*, vehiculo:vehiculos(placa,marca), conductor:conductores(nombre)')
      .single();

    if (error) throw new Error(error.message);
    return data as unknown as RegistroCombustible;
  }
}
