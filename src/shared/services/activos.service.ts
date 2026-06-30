// -- create table sgc.activos_fijos (
//   id uuid primary key default gen_random_uuid(),
//   codigo text not null unique,
//   nombre text not null,
//   descripcion text,
//   categoria_id int references sgc.categorias_inventario(id),
//   valor_adquisicion numeric(14,2) not null,
//   fecha_adquisicion date not null,
//   vida_util_anios int,
//   estado text not null default 'activo',
//   ubicacion text,
//   responsable_id uuid references sgc.usuarios(id),
//   notas text,
//   activo boolean not null default true,
//   created_at timestamptz default now(),
//   updated_at timestamptz default now()
// );
// -- alter table sgc.activos_fijos enable row level security;
// -- create policy "activos_fijos: read" on sgc.activos_fijos for select to authenticated using (true);
// -- create policy "activos_fijos: write" on sgc.activos_fijos for all to authenticated using (true) with check (true);
// -- grant select, insert, update on sgc.activos_fijos to authenticated;

import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';
import { ActivoFijo, ActivoFormData } from '../models/activo.model';

const SELECT_QUERY = '*, categoria:categorias_inventario(nombre), responsable:usuarios(nombre)';

@Injectable({ providedIn: 'root' })
export class ActivosService {
  private supabase = inject(SupabaseService);

  async getAll(): Promise<ActivoFijo[]> {
    const { data, error } = await this.supabase.client
      .from('activos_fijos')
      .select(SELECT_QUERY)
      .order('codigo');

    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as ActivoFijo[];
  }

  async create(payload: ActivoFormData): Promise<ActivoFijo> {
    const { data, error } = await this.supabase.client
      .from('activos_fijos')
      .insert(payload)
      .select(SELECT_QUERY)
      .single();

    if (error) throw new Error(error.message);
    return data as unknown as ActivoFijo;
  }

  async update(id: string, payload: Partial<ActivoFormData>): Promise<ActivoFijo> {
    const { data, error } = await this.supabase.client
      .from('activos_fijos')
      .update({ ...payload, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select(SELECT_QUERY)
      .single();

    if (error) throw new Error(error.message);
    return data as unknown as ActivoFijo;
  }

  async toggleActivo(id: string, activo: boolean): Promise<void> {
    const { error } = await this.supabase.client
      .from('activos_fijos')
      .update({ activo, updated_at: new Date().toISOString() })
      .eq('id', id);

    if (error) throw new Error(error.message);
  }
}
