import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';
import { Conductor, ConductorFormData } from '../models/conductor.model';
import { ConductorStats } from '../models/vehiculo-asignacion.model';

@Injectable({ providedIn: 'root' })
export class ConductoresService {
  private supabase = inject(SupabaseService);

  async getAll(): Promise<Conductor[]> {
    const { data, error } = await this.supabase.client
      .from('conductores')
      .select('*, vehiculo:vehiculos(placa, marca, modelo), usuario:usuarios(nombre)')
      .order('nombre');

    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as Conductor[];
  }

  /** Un conductor con sus joins (perfil, R5). */
  async getById(id: string): Promise<Conductor | null> {
    const { data, error } = await this.supabase.client
      .from('conductores')
      .select('*, vehiculo:vehiculos(placa, marca, modelo), usuario:usuarios(nombre)')
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (data as unknown as Conductor) ?? null;
  }

  /** Stats agregados del conductor (vista sgc.v_conductor_stats, R5). */
  async getStats(conductorId: string): Promise<ConductorStats | null> {
    const { data, error } = await this.supabase.client
      .from('v_conductor_stats')
      .select('*')
      .eq('conductor_id', conductorId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (data as unknown as ConductorStats) ?? null;
  }

  /** Auto-registro de conductor sin aprobación (RPC, R2). */
  async autoRegistrar(payload: {
    cedula: string;
    licencia_tipo: string;
    licencia_numero?: string | null;
    licencia_vencimiento?: string | null;
    tipo_vehiculo_autorizado?: string;
  }): Promise<Record<string, unknown>> {
    const { data, error } = await this.supabase.client.rpc('auto_registrar_conductor', {
      p_cedula: payload.cedula,
      p_licencia_tipo: payload.licencia_tipo,
      p_licencia_numero: payload.licencia_numero ?? null,
      p_licencia_vencimiento: payload.licencia_vencimiento ?? null,
      p_tipo_vehiculo_autorizado: payload.tipo_vehiculo_autorizado ?? 'Ambos',
    });
    if (error) throw new Error(error.message);
    return (data ?? {}) as Record<string, unknown>;
  }

  async create(payload: ConductorFormData): Promise<Conductor> {
    const { data, error } = await this.supabase.client
      .from('conductores')
      .insert(payload)
      .select('*, vehiculo:vehiculos(placa, marca, modelo), usuario:usuarios(nombre)')
      .single();

    if (error) throw new Error(error.message);
    return data as unknown as Conductor;
  }

  async update(id: string, payload: Partial<ConductorFormData>): Promise<Conductor> {
    const { data, error } = await this.supabase.client
      .from('conductores')
      .update({ ...payload, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('*, vehiculo:vehiculos(placa, marca, modelo), usuario:usuarios(nombre)')
      .single();

    if (error) throw new Error(error.message);
    return data as unknown as Conductor;
  }

  /** Active app users, for linking a driver to their CSD App account. */
  async getUsuariosVinculables(): Promise<{ id: string; nombre: string }[]> {
    const { data, error } = await this.supabase.client
      .from('usuarios')
      .select('id, nombre')
      .eq('activo', true)
      .order('nombre');

    if (error) throw new Error(error.message);
    return (data ?? []) as { id: string; nombre: string }[];
  }

  async toggleActivo(id: string, activo: boolean): Promise<void> {
    const { error } = await this.supabase.client
      .from('conductores')
      .update({ activo, updated_at: new Date().toISOString() })
      .eq('id', id);

    if (error) throw new Error(error.message);
  }
}
