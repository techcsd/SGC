import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';

export interface OtroValorFrecuente {
  contexto: string;
  valor_normalizado: string;
  ejemplo: string;
  repeticiones: number;
  ultima_vez: string;
  supera_umbral: boolean;
}

/** U25 — inteligencia de "Otro/s": valores de texto libre agrupados por contexto. */
@Injectable({ providedIn: 'root' })
export class OtrosValoresService {
  private supabase = inject(SupabaseService);

  async getFrecuentes(): Promise<OtroValorFrecuente[]> {
    const { data, error } = await this.supabase.client
      .from('v_otros_valores_frecuentes')
      .select('*')
      .order('repeticiones', { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as OtroValorFrecuente[];
  }
}
