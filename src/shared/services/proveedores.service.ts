import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';
import { Proveedor } from '../models/proveedor.model';

export interface ProveedorPayload {
  nombre: string;
  rnc?: string | null;
  contacto?: string | null;
  telefono?: string | null;
  email?: string | null;
  direccion?: string | null;
  activo?: boolean;
  is_hardware_store?: boolean;
  lat?: number | null;
  lng?: number | null;
  es_prueba?: boolean;
}

/** AF32 — ferretería visible para choferes (RPC ferreterias_visibles). */
export interface FerreteriaVisible {
  id: string;
  nombre: string;
  direccion: string | null;
  lat: number | null;
  lng: number | null;
  telefono: string | null;
  contacto: string | null;
}

@Injectable({ providedIn: 'root' })
export class ProveedoresService {
  private supabase = inject(SupabaseService);

  async getAll(): Promise<Proveedor[]> {
    const { data, error } = await this.supabase.client
      .schema('sgc')
      .from('proveedores')
      .select('*')
      .order('nombre');

    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as Proveedor[];
  }

  /** AF32 — ferreterías visibles para choferes (origen de conduce en la app). */
  async getFerreterias(): Promise<FerreteriaVisible[]> {
    const { data, error } = await this.supabase.client.rpc('ferreterias_visibles');
    if (error) throw new Error(error.message);
    return (data ?? []) as FerreteriaVisible[];
  }

  async create(payload: ProveedorPayload): Promise<Proveedor> {
    const { data, error } = await this.supabase.client
      .schema('sgc')
      .from('proveedores')
      .insert(payload)
      .select('*')
      .single();

    if (error) throw new Error(error.message);
    return data as unknown as Proveedor;
  }

  async update(id: string, payload: Partial<ProveedorPayload>): Promise<Proveedor> {
    const { data, error } = await this.supabase.client
      .schema('sgc')
      .from('proveedores')
      .update(payload)
      .eq('id', id)
      .select('*')
      .single();

    if (error) throw new Error(error.message);
    return data as unknown as Proveedor;
  }

  async toggleActivo(id: string, activo: boolean): Promise<void> {
    const { error } = await this.supabase.client
      .schema('sgc')
      .from('proveedores')
      .update({ activo })
      .eq('id', id);

    if (error) throw new Error(error.message);
  }
}
