import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';
import { Categoria, CategoriaFlat, CategoriaFormData } from '../models/categoria.model';
import { homologarTexto } from '../utils/texto.util';

@Injectable({ providedIn: 'root' })
export class CategoriasService {
  private supabase = inject(SupabaseService);

  /** Categorías activas, destacadas primero y luego por orden (R16). */
  async getAll(): Promise<Categoria[]> {
    const { data, error } = await this.supabase.client
      .from('categorias_inventario')
      .select('*')
      .eq('activo', true)
      .order('destacada', { ascending: false })
      .order('orden', { ascending: true })
      .order('nombre', { ascending: true });

    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as Categoria[];
  }

  /** Todas (activas e inactivas) para la gestión admin. */
  async getAllAdmin(): Promise<Categoria[]> {
    const { data, error } = await this.supabase.client
      .from('categorias_inventario')
      .select('*')
      .order('destacada', { ascending: false })
      .order('orden', { ascending: true })
      .order('nombre', { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as Categoria[];
  }

  async create(payload: CategoriaFormData): Promise<Categoria> {
    const { data, error } = await this.supabase.client
      .from('categorias_inventario')
      .insert({ ...payload, nombre: homologarTexto(payload.nombre) })
      .select('*')
      .single();
    if (error) throw new Error(error.message);
    return data as unknown as Categoria;
  }

  async update(id: number, payload: Partial<CategoriaFormData>): Promise<Categoria> {
    const patch = { ...payload };
    if (patch.nombre != null) patch.nombre = homologarTexto(patch.nombre);
    const { data, error } = await this.supabase.client
      .from('categorias_inventario')
      .update(patch)
      .eq('id', id)
      .select('*')
      .single();
    if (error) throw new Error(error.message);
    return data as unknown as Categoria;
  }

  async toggleActivo(id: number, activo: boolean): Promise<void> {
    const { error } = await this.supabase.client
      .from('categorias_inventario')
      .update({ activo })
      .eq('id', id);
    if (error) throw new Error(error.message);
  }

  /** Flattens the category tree into an ordered list with depth for <select> rendering */
  buildFlatList(categories: Categoria[]): CategoriaFlat[] {
    const flat: CategoriaFlat[] = [];

    const visit = (cat: Categoria, depth: number) => {
      flat.push({
        ...cat,
        depth,
        label: '    '.repeat(depth) + cat.nombre,
      });
      categories
        .filter((c) => c.padre_id === cat.id)
        .forEach((child) => visit(child, depth + 1));
    };

    categories.filter((c) => c.padre_id === null).forEach((root) => visit(root, 0));
    return flat;
  }
}
