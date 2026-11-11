import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';
import { RrhhTramite, TramiteTipo } from '../models/rrhh-administracion.model';

/** DN-29 — RRHH › Administración (Trámites construido esta ronda; Proveedores
 *  administrativos y Activos de oficina tienen esquema+RLS en dev, sin UI
 *  todavía — ver docs/RRHH-ADMIN.md). */
@Injectable({ providedIn: 'root' })
export class RrhhAdministracionService {
  private supabase = inject(SupabaseService);

  async listarTramites(): Promise<RrhhTramite[]> {
    const { data, error } = await this.supabase.client
      .from('rrhh_tramites')
      .select('*')
      .order('fecha_vencimiento', { ascending: true, nullsFirst: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as RrhhTramite[];
  }

  async crearTramite(payload: {
    nombre: string; tipo: TramiteTipo; entidad_responsable: string | null;
    numero_referencia: string | null; fecha_emision: string | null; fecha_vencimiento: string | null; notas: string | null;
  }): Promise<void> {
    const { error } = await this.supabase.client.from('rrhh_tramites').insert(payload);
    if (error) throw new Error(error.message);
  }

  async actualizarEstadoTramite(id: string, estado: RrhhTramite['estado']): Promise<void> {
    const { error } = await this.supabase.client
      .from('rrhh_tramites')
      .update({ estado, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw new Error(error.message);
  }

  async eliminarTramite(id: string): Promise<void> {
    const { error } = await this.supabase.client.from('rrhh_tramites').delete().eq('id', id);
    if (error) throw new Error(error.message);
  }
}
