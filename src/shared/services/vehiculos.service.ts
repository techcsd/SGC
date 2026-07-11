import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';
import { Vehiculo, VehiculoFormData } from '../models/vehiculo.model';

/** A vehicle custody handoff captured from the CSD field app. */
export interface VehiculoEntrega {
  id: string;
  vehiculo_id: string;
  tipo: 'recepcion' | 'devolucion';
  estado: 'abierta' | 'cerrada';
  km: number;
  combustible: string;
  tiene_danos: boolean;
  requiere_revision: boolean;
  observacion: string | null;
  firma_url: string | null;
  capturado_en: string;
  created_at: string;
  vehiculo?: { placa: string; marca: string; modelo: string } | null;
  conductor?: { nombre: string } | null;
  fotos?: { id: string; slot: string; storage_path: string }[];
  danos?: { id: string; zona: string; descripcion: string | null; foto_path: string; es_nuevo: boolean }[];
}

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

  /**
   * Vehicle responsibility history captured by the CSD field app
   * (`vehiculo_entregas`). RLS scopes visibility: flota staff see everything.
   * usuarios is joined twice (conductor / creado_por) so the embed must name
   * the FK to stay unambiguous.
   */
  async getResponsabilidad(): Promise<VehiculoEntrega[]> {
    const { data, error } = await this.supabase.client
      .from('vehiculo_entregas')
      .select(
        '*, vehiculo:vehiculos(placa, marca, modelo),' +
          ' conductor:usuarios!vehiculo_entregas_conductor_usuario_id_fkey(nombre),' +
          ' fotos:vehiculo_entrega_fotos(id, slot, storage_path),' +
          ' danos:vehiculo_entrega_danos(id, zona, descripcion, foto_path, es_nuevo)',
      )
      .order('created_at', { ascending: false });

    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as VehiculoEntrega[];
  }

  /** Resolves a checklist photo/signature path to a time-limited signed URL. */
  async getEntregaFotoUrl(path: string): Promise<string> {
    const { data, error } = await this.supabase.client.storage
      .from('vehiculos')
      .createSignedUrl(path, 3600);
    if (error) throw new Error(error.message);
    return data.signedUrl;
  }
}
