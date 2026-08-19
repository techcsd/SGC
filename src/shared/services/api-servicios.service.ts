import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';

/** AW9 — servicio/API del proyecto con su costo estimado mensual (manual). */
export interface ApiServicio {
  id: number;
  nombre: string;
  proveedor: string | null;
  proposito: string | null;
  donde_se_usa: string | null;
  costo_estimado_mes: number | null;
  moneda: string;
  panel_url: string | null;
  notas: string | null;
  activo: boolean;
  orden: number;
}

export type ApiServicioInput = Omit<ApiServicio, 'id'>;

@Injectable({ providedIn: 'root' })
export class ApiServiciosService {
  private supabase = inject(SupabaseService);

  async getAll(): Promise<ApiServicio[]> {
    const { data, error } = await this.supabase.client
      .from('api_servicios')
      .select('*')
      .order('orden')
      .order('nombre');
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as ApiServicio[];
  }

  async create(input: Partial<ApiServicioInput>): Promise<ApiServicio> {
    const { data, error } = await this.supabase.client
      .from('api_servicios')
      .insert({ moneda: 'USD', activo: true, orden: 99, ...input })
      .select('*')
      .single();
    if (error) throw new Error(error.message);
    return data as unknown as ApiServicio;
  }

  async update(id: number, patch: Partial<ApiServicioInput>): Promise<void> {
    const { error } = await this.supabase.client.from('api_servicios').update(patch).eq('id', id);
    if (error) throw new Error(error.message);
  }

  async remove(id: number): Promise<void> {
    const { error } = await this.supabase.client.from('api_servicios').delete().eq('id', id);
    if (error) throw new Error(error.message);
  }
}
