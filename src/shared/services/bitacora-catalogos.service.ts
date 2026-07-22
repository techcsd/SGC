import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';

export type BitacoraCatalogoTipo =
  | 'estructura'
  | 'actividad'
  | 'restriccion'
  | 'suceso_incidente'
  | 'suceso_accidente'
  | 'suceso_equipo';

export interface BitacoraCatalogo {
  id: number;
  tipo: BitacoraCatalogoTipo;
  valor: string;
  activo: boolean;
  orden: number;
}

export interface CatalogosBitacora {
  estructuras: string[];
  actividades: string[];
  restricciones: { value: string; label: string }[];
}

/** Row shape returned by the sgc.catalogo_ordenado(p_proyecto_id) RPC. */
interface CatalogoOrdenadoRow {
  tipo: string;
  valor: string;
  activo: boolean;
  orden: number;
  usos: number;
  destacado: boolean;
}

@Injectable({ providedIn: 'root' })
export class BitacoraCatalogosService {
  private supabase = inject(SupabaseService);

  /** Active catalogs for the bitácora form (process order, fallback alphabetical). */
  async getCatalogos(): Promise<CatalogosBitacora> {
    const rows = await this.fetch(true);
    const by = (t: string) => rows.filter((r) => r.tipo === t).map((r) => r.valor);
    return {
      estructuras: by('estructura'),
      actividades: by('actividad'),
      restricciones: by('restriccion').map((v) => ({ value: v, label: this.titleCase(v) })),
    };
  }

  /**
   * S2 — catalogs ordered by usage ranking for a given obra: the ~3 most-used
   * estructuras/actividades of that project first, then the rest in process order.
   * Consumed by the web bitácora form and the field app. Falls back to
   * getCatalogos() if the RPC is unavailable.
   */
  async getCatalogosOrdenados(proyectoId: string | null): Promise<CatalogosBitacora> {
    const { data, error } = await this.supabase.client.rpc('catalogo_ordenado', {
      p_proyecto_id: proyectoId,
    });
    if (error || !data) return this.getCatalogos();
    const rows = data as unknown as CatalogoOrdenadoRow[];
    const by = (t: string) => rows.filter((r) => r.tipo === t).map((r) => r.valor);
    return {
      estructuras: by('estructura'),
      actividades: by('actividad'),
      restricciones: by('restriccion').map((v) => ({ value: v, label: this.titleCase(v) })),
    };
  }

  /**
   * S13 — sucesos probables por subtipo de incidente (accidente/equipo/incidente),
   * ordenados. Devuelve solo los valores activos de cada catálogo.
   */
  async getSucesos(): Promise<{ incidente: string[]; accidente: string[]; equipo: string[] }> {
    const { data, error } = await this.supabase.client
      .from('bitacora_catalogos')
      .select('tipo, valor')
      .eq('activo', true)
      .in('tipo', ['suceso_incidente', 'suceso_accidente', 'suceso_equipo'])
      .order('orden')
      .order('valor');
    const rows = (error ? [] : (data ?? [])) as { tipo: string; valor: string }[];
    const by = (t: string) => rows.filter((r) => r.tipo === t).map((r) => r.valor);
    return {
      incidente: by('suceso_incidente'),
      accidente: by('suceso_accidente'),
      equipo: by('suceso_equipo'),
    };
  }

  /** All rows (admin management), ordered by tipo then orden. */
  async getAll(): Promise<BitacoraCatalogo[]> {
    return this.fetch(false);
  }

  private async fetch(onlyActive: boolean): Promise<BitacoraCatalogo[]> {
    let query = this.supabase.client
      .from('bitacora_catalogos')
      .select('*')
      .order('tipo')
      .order('orden')
      .order('valor');
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

  /** S2 — admin edits the display order of a catalog value. */
  async updateOrden(id: number, orden: number): Promise<void> {
    const { error } = await this.supabase.client
      .from('bitacora_catalogos')
      .update({ orden })
      .eq('id', id);
    if (error) throw new Error(error.message);
  }

  private titleCase(v: string): string {
    return v.charAt(0).toUpperCase() + v.slice(1).toLowerCase();
  }
}
