import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';
import { Bodega, BodegaFormData } from '../models/bodega.model';

@Injectable({ providedIn: 'root' })
export class BodegasService {
  private supabase = inject(SupabaseService);

  async getAll(): Promise<Bodega[]> {
    const { data, error } = await this.supabase.client
      .from('bodegas')
      .select('*, proyecto:proyectos(nombre)')
      .order('nombre');

    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as Bodega[];
  }

  async create(formData: BodegaFormData): Promise<Bodega> {
    const { data, error } = await this.supabase.client
      .from('bodegas')
      .insert(formData)
      .select('*, proyecto:proyectos(nombre)')
      .single();

    if (error) throw new Error(error.message);
    return data as unknown as Bodega;
  }

  async update(id: string, formData: Partial<BodegaFormData>): Promise<Bodega> {
    const { data, error } = await this.supabase.client
      .from('bodegas')
      .update(formData)
      .eq('id', id)
      .select('*, proyecto:proyectos(nombre)')
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

  /** Z21 — IDs de proyecto que ya tienen al menos un almacén (activo o no). */
  async getProyectoIdsConAlmacen(): Promise<string[]> {
    const { data, error } = await this.supabase.client
      .from('bodegas')
      .select('proyecto_id')
      .not('proyecto_id', 'is', null);
    if (error) throw new Error(error.message);
    return [...new Set((data ?? []).map((r: { proyecto_id: string }) => r.proyecto_id))];
  }
}
