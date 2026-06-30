// SQL — run once in Supabase SQL editor to create the table:
//
// create table sgc.entradas_inventario (
//   id uuid primary key default gen_random_uuid(),
//   articulo_id uuid not null references sgc.articulos(id),
//   bodega_id uuid not null references sgc.bodegas(id),
//   cantidad numeric(12,2) not null check (cantidad > 0),
//   costo_unitario numeric(12,2),
//   proveedor text,
//   motivo text,
//   fecha date not null default current_date,
//   referencia text,
//   creado_por uuid references sgc.usuarios(id),
//   created_at timestamptz default now()
// );
// alter table sgc.entradas_inventario enable row level security;
// create policy "entradas: read" on sgc.entradas_inventario for select to authenticated using (true);
// create policy "entradas: insert" on sgc.entradas_inventario for insert to authenticated with check (true);
// grant select, insert on sgc.entradas_inventario to authenticated;

import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';
import { EntradaInventario, EntradaFormData } from '../models/entrada.model';

const SELECT_QUERY =
  '*, articulo:articulos(nombre, codigo, unidad), bodega:bodegas(nombre)';

@Injectable({ providedIn: 'root' })
export class EntradasService {
  private supabase = inject(SupabaseService);

  async getAll(): Promise<EntradaInventario[]> {
    const { data, error } = await this.supabase.client
      .from('entradas_inventario')
      .select(SELECT_QUERY)
      .order('created_at', { ascending: false });

    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as EntradaInventario[];
  }

  async create(payload: EntradaFormData, userId: string | null): Promise<EntradaInventario> {
    const { data, error } = await this.supabase.client
      .from('entradas_inventario')
      .insert({ ...payload, creado_por: userId })
      .select(SELECT_QUERY)
      .single();

    if (error) throw new Error(error.message);
    return data as unknown as EntradaInventario;
  }
}
