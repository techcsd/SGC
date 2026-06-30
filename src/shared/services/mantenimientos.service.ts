import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';
import { Mantenimiento, MantenimientoFormData } from '../models/mantenimiento.model';

@Injectable({ providedIn: 'root' })
export class MantenimientosService {
  private supabase = inject(SupabaseService);

  async getAll(): Promise<Mantenimiento[]> {
    const { data, error } = await this.supabase.client
      .from('mantenimientos')
      .select('*, vehiculo:vehiculos(placa,marca,modelo)')
      .order('fecha', { ascending: false });

    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as Mantenimiento[];
  }

  async create(payload: MantenimientoFormData): Promise<Mantenimiento> {
    const { data, error } = await this.supabase.client
      .from('mantenimientos')
      .insert(payload)
      .select('*, vehiculo:vehiculos(placa,marca,modelo)')
      .single();

    if (error) throw new Error(error.message);
    return data as unknown as Mantenimiento;
  }

  async update(id: string, payload: Partial<MantenimientoFormData>): Promise<Mantenimiento> {
    const { data, error } = await this.supabase.client
      .from('mantenimientos')
      .update(payload)
      .eq('id', id)
      .select('*, vehiculo:vehiculos(placa,marca,modelo)')
      .single();

    if (error) throw new Error(error.message);
    return data as unknown as Mantenimiento;
  }
}
