// -- create table sgc.salidas_inventario (
//   id uuid primary key default gen_random_uuid(),
//   articulo_id uuid not null references sgc.articulos(id),
//   bodega_id uuid not null references sgc.bodegas(id),
//   cantidad numeric(12,2) not null check (cantidad > 0),
//   motivo text not null,
//   proyecto_referencia text,
//   fecha date not null default current_date,
//   referencia text,
//   notas text,
//   creado_por uuid references sgc.usuarios(id),
//   created_at timestamptz default now()
// );
// -- alter table sgc.salidas_inventario enable row level security;
// -- create policy "salidas: read" on sgc.salidas_inventario for select to authenticated using (true);
// -- create policy "salidas: insert" on sgc.salidas_inventario for insert to authenticated with check (true);
// -- grant select, insert on sgc.salidas_inventario to authenticated;

import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';
import { SalidaInventario, SalidaFormData } from '../models/salida.model';

@Injectable({ providedIn: 'root' })
export class SalidasService {
  private supabase = inject(SupabaseService);

  async getAll(): Promise<SalidaInventario[]> {
    const { data, error } = await this.supabase.client
      .from('salidas_inventario')
      .select('*, articulo:articulos(nombre, codigo, unidad), bodega:bodegas(nombre)')
      .order('created_at', { ascending: false });

    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as SalidaInventario[];
  }

  async create(payload: SalidaFormData, userId: string | null): Promise<SalidaInventario> {
    const { data, error } = await this.supabase.client
      .from('salidas_inventario')
      .insert({ ...payload, creado_por: userId })
      .select('*, articulo:articulos(nombre, codigo, unidad), bodega:bodegas(nombre)')
      .single();

    if (error) throw new Error(error.message);
    return data as unknown as SalidaInventario;
  }
}
