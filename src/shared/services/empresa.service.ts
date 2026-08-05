import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';

/** AG13 — datos generales de la empresa (fila única). */
export interface Empresa {
  id: number;
  razon_social: string | null;
  nombre_comercial: string | null;
  rnc: string | null;
  direccion: string | null;
  ciudad: string | null;
  pais: string | null;
  telefono: string | null;
  email: string | null;
  sitio_web: string | null;
  logo_path: string | null;
  updated_at: string;
}

export type EmpresaPatch = Partial<Omit<Empresa, 'id' | 'updated_at'>>;

@Injectable({ providedIn: 'root' })
export class EmpresaService {
  private supabase = inject(SupabaseService);

  async get(): Promise<Empresa | null> {
    const { data, error } = await this.supabase.client
      .schema('sgc')
      .from('empresa')
      .select('*')
      .eq('id', 1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (data as unknown as Empresa) ?? null;
  }

  async update(patch: EmpresaPatch): Promise<void> {
    const { error } = await this.supabase.client
      .schema('sgc')
      .from('empresa')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', 1);
    if (error) throw new Error(error.message);
  }
}
