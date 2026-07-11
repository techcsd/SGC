import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';

export interface BitacoraCatalogo {
  id: number;
  tipo: 'estructura' | 'actividad' | 'restriccion';
  valor: string;
  activo: boolean;
}

export interface CatalogosBitacora {
  estructuras: string[];
  actividades: string[];
  restricciones: { value: string; label: string }[];
}

@Injectable({ providedIn: 'root' })
export class BitacoraCatalogosService {
  private supabase = inject(SupabaseService);

  /** Active catalogs for the bitácora form. */
  async getCatalogos(): Promise<CatalogosBitacora> {
    const rows = await this.fetch(true);
    const by = (t: string) => rows.filter((r) => r.tipo === t).map((r) => r.valor);
    return {
      estructuras: by('estructura'),
      actividades: by('actividad'),
      restricciones: by('restriccion').map((v) => ({ value: v, label: this.titleCase(v) })),
    };
  }

  /** All rows (admin management). */
  async getAll(): Promise<BitacoraCatalogo[]> {
    return this.fetch(false);
  }

  private async fetch(onlyActive: boolean): Promise<BitacoraCatalogo[]> {
    let query = this.supabase.client.from('bitacora_catalogos').select('*').order('tipo').order('valor');
    if (onlyActive) query = query.eq('activo', true);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as BitacoraCatalogo[];
  }

  async create(tipo: string, valor: string): Promise<BitacoraCatalogo> {
    const { data, error } = await this.supabase.client
      .from('bitacora_catalogos')
      .insert({ tipo, valor: valor.trim().toUpperCase() })
      .select('*')
      .single();
    if (error) {
      if (error.code === '23505') throw new Error('Ese valor ya existe en el catálogo.');
      throw new Error(error.message);
    }
    return data as unknown as BitacoraCatalogo;
  }

  async toggleActivo(id: number, activo: boolean): Promise<void> {
    const { error } = await this.supabase.client
      .from('bitacora_catalogos')
      .update({ activo })
      .eq('id', id);
    if (error) throw new Error(error.message);
  }

  private titleCase(v: string): string {
    return v.charAt(0).toUpperCase() + v.slice(1).toLowerCase();
  }
}
