import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';

export interface MotivoMulta {
  id: number;
  nombre: string;
  orden: number;
  activo: boolean;
}

/** T9 — catálogo administrable de motivos de multa. */
@Injectable({ providedIn: 'root' })
export class MotivosMultaService {
  private supabase = inject(SupabaseService);

  async getActivos(): Promise<MotivoMulta[]> {
    const { data, error } = await this.supabase.client
      .from('motivos_multa')
      .select('*')
      .eq('activo', true)
      .order('orden')
      .order('nombre');
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as MotivoMulta[];
  }
}
