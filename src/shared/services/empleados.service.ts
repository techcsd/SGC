import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';
import { Empleado, EmpleadoDocumento } from '../models/empleado.model';

const EMPLEADO_SELECT = '*, jefe:empleados!empleados_jefe_id_fkey(nombre, apellido)';

@Injectable({ providedIn: 'root' })
export class EmpleadosService {
  private supabase = inject(SupabaseService);

  async getAll(): Promise<Empleado[]> {
    const { data, error } = await this.supabase.client
      .from('empleados')
      .select(EMPLEADO_SELECT)
      .order('apellido')
      .order('nombre');

    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as Empleado[];
  }

  async create(payload: Partial<Empleado>): Promise<Empleado> {
    const { data, error } = await this.supabase.client
      .from('empleados')
      .insert(payload)
      .select(EMPLEADO_SELECT)
      .single();

    if (error) throw new Error(error.message);
    return data as unknown as Empleado;
  }

  async update(id: string, payload: Partial<Empleado>): Promise<Empleado> {
    const { data, error } = await this.supabase.client
      .from('empleados')
      .update({ ...payload, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select(EMPLEADO_SELECT)
      .single();

    if (error) throw new Error(error.message);
    return data as unknown as Empleado;
  }

  // ── Employee documents ───────────────────────────────────
  async getDocumentos(empleadoId: string): Promise<EmpleadoDocumento[]> {
    const { data, error } = await this.supabase.client
      .from('empleado_documentos')
      .select('*')
      .eq('empleado_id', empleadoId)
      .order('created_at', { ascending: false });

    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as EmpleadoDocumento[];
  }

  async subirDocumento(empleadoId: string, tipo: string, file: File, subidoPor: string | null): Promise<EmpleadoDocumento> {
    const path = `${empleadoId}/${crypto.randomUUID()}-${file.name}`;
    const { error: uploadError } = await this.supabase.client.storage.from('sgc-rrhh').upload(path, file);
    if (uploadError) throw new Error(uploadError.message);

    const { data, error } = await this.supabase.client
      .from('empleado_documentos')
      .insert({ empleado_id: empleadoId, tipo, nombre: file.name, archivo_path: path, tipo_mime: file.type || null, subido_por: subidoPor })
      .select()
      .single();

    if (error) throw new Error(error.message);
    return data as unknown as EmpleadoDocumento;
  }

  async getDocumentoUrl(path: string): Promise<string> {
    const { data, error } = await this.supabase.client.storage.from('sgc-rrhh').createSignedUrl(path, 3600);
    if (error) throw new Error(error.message);
    return data.signedUrl;
  }

  async eliminarDocumento(id: string, path: string): Promise<void> {
    await this.supabase.client.storage.from('sgc-rrhh').remove([path]);
    const { error } = await this.supabase.client.from('empleado_documentos').delete().eq('id', id);
    if (error) throw new Error(error.message);
  }

  async toggleActivo(id: string, activo: boolean): Promise<void> {
    const { error } = await this.supabase.client
      .from('empleados')
      .update({ activo, updated_at: new Date().toISOString() })
      .eq('id', id);

    if (error) throw new Error(error.message);
  }
}
