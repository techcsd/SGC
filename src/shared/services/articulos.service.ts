import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';
import { Articulo, ArticuloFormData } from '../models/articulo.model';

@Injectable({ providedIn: 'root' })
export class ArticulosService {
  private supabase = inject(SupabaseService);

  async getAll(): Promise<Articulo[]> {
    const { data, error } = await this.supabase.client
      .from('articulos')
      .select('*, categoria:categorias_inventario(nombre)')
      // Orden oficial del catálogo (Excel) dentro de cada categoría, luego nombre.
      .order('orden', { ascending: true, nullsFirst: false })
      .order('nombre');

    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as Articulo[];
  }

  async getById(id: string): Promise<Articulo> {
    const { data, error } = await this.supabase.client
      .from('articulos')
      .select('*, categoria:categorias_inventario(nombre)')
      .eq('id', id)
      .single();

    if (error) throw new Error(error.message);
    return data as unknown as Articulo;
  }

  async generateNextCode(): Promise<string> {
    const { data, error } = await this.supabase.client
      .from('articulos')
      .select('codigo')
      .like('codigo', 'ART-%')
      .order('codigo', { ascending: false })
      .limit(1);

    if (error) throw new Error(error.message);

    const last = data?.[0]?.codigo as string | undefined;
    const lastNumber = last ? parseInt(last.replace('ART-', ''), 10) || 0 : 0;
    return `ART-${String(lastNumber + 1).padStart(4, '0')}`;
  }

  async create(formData: ArticuloFormData): Promise<Articulo> {
    const codigo = await this.generateNextCode();
    const { data, error } = await this.supabase.client
      .from('articulos')
      .insert({ ...formData, codigo })
      .select('*, categoria:categorias_inventario(nombre)')
      .single();

    if (error) throw new Error(error.message);
    return data as unknown as Articulo;
  }

  async update(id: string, formData: Partial<ArticuloFormData>): Promise<Articulo> {
    const { data, error } = await this.supabase.client
      .from('articulos')
      .update({ ...formData, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('*, categoria:categorias_inventario(nombre)')
      .single();

    if (error) throw new Error(error.message);
    return data as unknown as Articulo;
  }

  async toggleActivo(id: string, activo: boolean): Promise<void> {
    const { error } = await this.supabase.client
      .from('articulos')
      .update({ activo, updated_at: new Date().toISOString() })
      .eq('id', id);

    if (error) throw new Error(error.message);
  }
}
