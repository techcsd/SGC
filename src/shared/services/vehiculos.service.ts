import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';
import { Vehiculo, VehiculoFormData } from '../models/vehiculo.model';

// TODO: Run this SQL in Supabase to create the flota tables:
//
// create table sgc.vehiculos (
//   id uuid primary key default gen_random_uuid(),
//   placa text not null unique,
//   marca text not null,
//   modelo text not null,
//   anio int not null,
//   tipo text not null,
//   estado text not null default 'activo',
//   color text,
//   kilometraje int not null default 0,
//   capacidad_carga text,
//   responsable_id uuid references sgc.usuarios(id),
//   notas text,
//   activo boolean not null default true,
//   created_at timestamptz default now(),
//   updated_at timestamptz default now()
// );
// alter table sgc.vehiculos enable row level security;
// create policy "vehiculos: read" on sgc.vehiculos for select to authenticated using (true);
// create policy "vehiculos: write" on sgc.vehiculos for all to authenticated using (sgc.is_admin()) with check (sgc.is_admin());
// grant select, insert, update, delete on sgc.vehiculos to authenticated;

@Injectable({ providedIn: 'root' })
export class VehiculosService {
  private supabase = inject(SupabaseService);

  async getAll(): Promise<Vehiculo[]> {
    const { data, error } = await this.supabase.client
      .from('vehiculos')
      .select('*, responsable:usuarios(nombre)')
      .order('placa');

    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as Vehiculo[];
  }

  async create(payload: VehiculoFormData): Promise<Vehiculo> {
    const { data, error } = await this.supabase.client
      .from('vehiculos')
      .insert(payload)
      .select('*, responsable:usuarios(nombre)')
      .single();

    if (error) throw new Error(error.message);
    return data as unknown as Vehiculo;
  }

  async update(id: string, payload: Partial<VehiculoFormData>): Promise<Vehiculo> {
    const { data, error } = await this.supabase.client
      .from('vehiculos')
      .update(payload)
      .eq('id', id)
      .select('*, responsable:usuarios(nombre)')
      .single();

    if (error) throw new Error(error.message);
    return data as unknown as Vehiculo;
  }

  async toggleActivo(id: string, activo: boolean): Promise<void> {
    const { error } = await this.supabase.client
      .from('vehiculos')
      .update({ activo })
      .eq('id', id);

    if (error) throw new Error(error.message);
  }
}
