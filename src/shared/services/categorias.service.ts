import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';
import { Categoria, CategoriaFlat } from '../models/categoria.model';

@Injectable({ providedIn: 'root' })
export class CategoriasService {
  private supabase = inject(SupabaseService);

  async getAll(): Promise<Categoria[]> {
    const { data, error } = await this.supabase.client
      .from('categorias_inventario')
      .select('*')
      .eq('activo', true)
      .order('id');

    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as Categoria[];
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
