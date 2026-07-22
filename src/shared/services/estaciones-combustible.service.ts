import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';

export interface EstacionCombustible {
  id: number;
  nombre: string;
  orden: number;
  activo: boolean;
}

/** T4 — catálogo administrable de estaciones de combustible (Total Energies default). */
@Injectable({ providedIn: 'root' })
export class EstacionesCombustibleService {
  private supabase = inject(SupabaseService);

  async getActivas(): Promise<EstacionCombustible[]> {
    const { data, error } = await this.supabase.client
      .from('estaciones_combustible')
      .select('*')
      .eq('activo', true)
      .order('orden')
      .order('nombre');
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as EstacionCombustible[];
  }
}
