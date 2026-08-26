import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';

/** AU4 — catálogo de referencia de RD para la cascada provincia → municipio → sector. */
export interface Provincia { id: number; nombre: string; activo: boolean; zona?: string | null; }
export interface Municipio { id: number; provincia_id: number; nombre: string; activo: boolean; }
export interface Sector { id: number; municipio_id: number; nombre: string; activo: boolean; }

/** AZ8 — resultado del buscador con autocompletado (con la cadena completa). */
export interface UbicacionMatch {
  nivel: 'provincia' | 'municipio' | 'sector';
  label: string;
  zona: string | null;
  provincia_id: number;
  provincia: string;
  municipio_id: number | null;
  municipio: string | null;
  sector_id: number | null;
  sector: string | null;
}

/** AZ8 — zonas de la empresa (derivadas de la provincia, override manual). */
export const ZONAS_RD = ['Este', 'Cibao', 'Sur', 'Gran Santo Domingo'] as const;

@Injectable({ providedIn: 'root' })
export class UbicacionRdService {
  private supabase = inject(SupabaseService);

  async getProvincias(): Promise<Provincia[]> {
    const { data, error } = await this.supabase.client
      .from('provincias').select('*').eq('activo', true).order('nombre');
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as Provincia[];
  }

  async getMunicipios(provinciaId: number): Promise<Municipio[]> {
    const { data, error } = await this.supabase.client
      .from('municipios').select('*').eq('provincia_id', provinciaId).eq('activo', true).order('nombre');
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as Municipio[];
  }

  async getSectores(municipioId: number): Promise<Sector[]> {
    const { data, error } = await this.supabase.client
      .from('sectores').select('*').eq('municipio_id', municipioId).eq('activo', true).order('nombre');
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as Sector[];
  }

  /** AZ8 — buscador con autocompletado sobre todo el catálogo (unaccent). */
  async buscar(q: string): Promise<UbicacionMatch[]> {
    if (!q || q.trim().length < 2) return [];
    const { data, error } = await this.supabase.client.rpc('buscar_ubicacion', { p_q: q });
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as UbicacionMatch[];
  }

  /** Crea un municipio sobre la marcha (admin/proyectos). Devuelve su id. */
  async agregarMunicipio(provinciaId: number, nombre: string): Promise<number> {
    const { data, error } = await this.supabase.client.rpc('agregar_municipio', {
      p_provincia_id: provinciaId, p_nombre: nombre,
    });
    if (error) throw new Error(error.message);
    return data as number;
  }

  /** Crea un sector sobre la marcha (admin/proyectos). Devuelve su id. */
  async agregarSector(municipioId: number, nombre: string): Promise<number> {
    const { data, error } = await this.supabase.client.rpc('agregar_sector', {
      p_municipio_id: municipioId, p_nombre: nombre,
    });
    if (error) throw new Error(error.message);
    return data as number;
  }
}
