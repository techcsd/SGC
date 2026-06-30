import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';
import { Obra } from '../models/obra.model';

@Injectable({ providedIn: 'root' })
export class ObrasService {
  private supabase = inject(SupabaseService);

  async getAll(): Promise<Obra[]> {
    const { data, error } = await this.supabase.client
      .from('obras')
      .select('*')
      .order('nombre');

    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as Obra[];
  }
}
