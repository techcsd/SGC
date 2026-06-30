import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';
import { Proveedor } from '../models/proveedor.model';

export interface ProveedorPayload {
  nombre: string;
  ruc?: string | null;
  telefono?: string | null;
  email?: string | null;
  direccion?: string | null;
  categoria?: string | null;
  contacto_nombre?: string | null;
  notas?: string | null;
  activo?: boolean;
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
      .update({ ...payload, updated_at: new Date().toISOString() })
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
      .update({ activo, updated_at: new Date().toISOString() })
      .eq('id', id);

    if (error) throw new Error(error.message);
  }
}
