import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';

export interface ConteoItem {
  cantidad_antes: number;
  cantidad_contada: number;
  articulo?: { nombre: string; codigo: string } | null;
}

export interface Conteo {
  id: string;
  motivo: string | null;
  created_at: string;
  bodega?: { nombre: string } | null;
  creado?: { nombre: string } | null;
  items?: ConteoItem[];
}

@Injectable({ providedIn: 'root' })
export class ConteosService {
  private supabase = inject(SupabaseService);

  /** Physical-count / stock-adjustment history. RLS: inventario/admin. */
  async getAll(): Promise<Conteo[]> {
    const { data, error } = await this.supabase.client
      .from('conteos_inventario')
      .select(
        'id, motivo, created_at, bodega:bodegas(nombre), creado:usuarios(nombre), items:conteo_items(cantidad_antes, cantidad_contada, articulo:articulos(nombre, codigo))',
      )
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as Conteo[];
  }
}
