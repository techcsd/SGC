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
import { pickColumns } from '../utils/pick-columns.util';

const SELECT_QUERY = '*, categoria:categorias_inventario(nombre), responsable:usuarios(nombre)';

/** BN3 (regla 10) — columnas reales de `sgc.activos_fijos` (verificadas en prod). */
const ACTIVO_COLS = new Set<string>([
  'codigo', 'nombre', 'descripcion', 'categoria_id', 'valor_adquisicion',
  'fecha_adquisicion', 'vida_util_anios', 'estado', 'ubicacion', 'responsable_id',
  'notas', 'activo', 'updated_at', 'es_prueba', 'asignado_tipo', 'asignado_id',
]);

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

  async generateNextCode(): Promise<string> {
    const { data, error } = await this.supabase.client
      .from('activos_fijos')
      .select('codigo')
      .like('codigo', 'ACT-%')
      .order('codigo', { ascending: false })
      .limit(1);

    if (error) throw new Error(error.message);

    const last = data?.[0]?.codigo as string | undefined;
    const lastNumber = last ? parseInt(last.replace('ACT-', ''), 10) || 0 : 0;
    return `ACT-${String(lastNumber + 1).padStart(4, '0')}`;
  }

  async create(payload: ActivoFormData): Promise<ActivoFijo> {
    const codigo = await this.generateNextCode();
    const { data, error } = await this.supabase.client
      .from('activos_fijos')
      .insert(pickColumns({ ...payload, codigo }, ACTIVO_COLS))
      .select(SELECT_QUERY)
      .single();

    if (error) throw new Error(error.message);
    return data as unknown as ActivoFijo;
  }

  async update(id: string, payload: Partial<ActivoFormData>): Promise<ActivoFijo> {
    const { data, error } = await this.supabase.client
      .from('activos_fijos')
      .update(pickColumns({ ...payload, updated_at: new Date().toISOString() }, ACTIVO_COLS))
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
