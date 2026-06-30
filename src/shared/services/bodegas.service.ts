import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';
import { Bodega, BodegaFormData } from '../models/bodega.model';

@Injectable({ providedIn: 'root' })
export class BodegasService {
  private supabase = inject(SupabaseService);

  async getAll(): Promise<Bodega[]> {
    const { data, error } = await this.supabase.client
      .from('bodegas')
      .select('*, responsable:usuarios(nombre)')
      .order('nombre');

    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as Bodega[];
  }

  async create(formData: BodegaFormData): Promise<Bodega> {
    const { data, error } = await this.supabase.client
      .from('bodegas')
      .insert(formData)
      .select('*, responsable:usuarios(nombre)')
      .single();

    if (error) throw new Error(error.message);
    return data as unknown as Bodega;
  }

  async update(id: string, formData: Partial<BodegaFormData>): Promise<Bodega> {
    const { data, error } = await this.supabase.client
      .from('bodegas')
      .update(formData)
      .eq('id', id)
      .select('*, responsable:usuarios(nombre)')
      .single();

    if (error) throw new Error(error.message);
    return data as unknown as Bodega;
  }

  async toggleActivo(id: string, activo: boolean): Promise<void> {
    const { error } = await this.supabase.client
      .from('bodegas')
      .update({ activo })
      .eq('id', id);

    if (error) throw new Error(error.message);
  }
}
