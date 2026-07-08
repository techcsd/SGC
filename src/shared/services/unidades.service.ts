import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';
import { Unidad, UnidadCreatePayload } from '../models/unidad.model';

@Injectable({ providedIn: 'root' })
export class UnidadesService {
  private supabase = inject(SupabaseService);

  /** Active units, for the articulo form <select>. */
  async getActivas(): Promise<Unidad[]> {
    const { data, error } = await this.supabase.client
      .from('unidades')
      .select('*')
      .eq('activo', true)
      .order('nombre');
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as Unidad[];
  }

  /** All units (admin management view). */
  async getAll(): Promise<Unidad[]> {
    const { data, error } = await this.supabase.client
      .from('unidades')
      .select('*')
      .order('nombre');
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as Unidad[];
  }

  async create(payload: UnidadCreatePayload): Promise<Unidad> {
    const { data, error } = await this.supabase.client
      .from('unidades')
      .insert(payload)
      .select('*')
      .single();
    if (error) {
      if (error.code === '23505') throw new Error('Ya existe una unidad con ese código.');
      throw new Error(error.message);
    }
    return data as unknown as Unidad;
  }

  /** Only the display name is editable — the código is referenced by artículos. */
  async updateNombre(id: number, nombre: string): Promise<void> {
    const { error } = await this.supabase.client
      .from('unidades')
      .update({ nombre })
      .eq('id', id);
    if (error) throw new Error(error.message);
  }

  async toggleActivo(id: number, activo: boolean): Promise<void> {
    const { error } = await this.supabase.client
      .from('unidades')
      .update({ activo })
      .eq('id', id);
    if (error) throw new Error(error.message);
  }

  /** unidad code from a display name: lowercase, no accents, alnum only. */
  static slug(nombre: string): string {
    return nombre
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
  }
}
