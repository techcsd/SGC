import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';
import {
  ObraElemento,
  ObraElementoFormData,
  ObraVaciado,
  ObraVaciadoFormData,
  ObraNoConformidad,
  ObraNoConformidadFormData,
  VaciadoEstado,
} from '../models/obra-ejecucion.model';

/**
 * CSD-OPE-01 — Registro de Vaciado y No Conformidades.
 * El cliente de Supabase ya tiene `db.schema = 'sgc'`, así que no hace falta .schema().
 * La regla de oro (una NC abierta bloquea el vaciado) la aplica un trigger en la BD:
 * al mover un vaciado a liberado/vaciado el trigger lanza una excepción cuyo mensaje
 * se propaga hasta la UI.
 */
@Injectable({ providedIn: 'root' })
export class ObraEjecucionService {
  private supabase = inject(SupabaseService);

  // ── Elementos / frentes de obra ────────────────────────────
  async getElementos(proyectoId: string): Promise<ObraElemento[]> {
    const { data, error } = await this.supabase.client
      .from('obra_elementos')
      .select('*')
      .eq('proyecto_id', proyectoId)
      .order('created_at', { ascending: true });

    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as ObraElemento[];
  }

  async crearElemento(proyectoId: string, payload: ObraElementoFormData): Promise<ObraElemento> {
    const { data, error } = await this.supabase.client
      .from('obra_elementos')
      .insert({ ...payload, proyecto_id: proyectoId })
      .select('*')
      .single();

    if (error) throw new Error(error.message);
    return data as unknown as ObraElemento;
  }

  // ── Registro de vaciado ────────────────────────────────────
  async getVaciados(proyectoId: string): Promise<ObraVaciado[]> {
    const { data, error } = await this.supabase.client
      .from('obra_vaciados')
      .select('*, elemento:obra_elementos(codigo, eje, bloque)')
      .eq('proyecto_id', proyectoId)
      .order('numero', { ascending: true });

    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as ObraVaciado[];
  }

  async crearVaciado(proyectoId: string, payload: ObraVaciadoFormData): Promise<ObraVaciado> {
    const { data, error } = await this.supabase.client
      .from('obra_vaciados')
      .insert({ ...payload, proyecto_id: proyectoId })
      .select('*, elemento:obra_elementos(codigo, eje, bloque)')
      .single();

    if (error) throw new Error(error.message);
    return data as unknown as ObraVaciado;
  }

  /**
   * Cambia el estado del vaciado. Si el trigger de la BD lo bloquea por una NC
   * abierta, relanza el mensaje tal cual para que la UI lo muestre.
   */
  async setEstadoVaciado(id: string, estado: VaciadoEstado): Promise<ObraVaciado> {
    const { data, error } = await this.supabase.client
      .from('obra_vaciados')
      .update({ estado })
      .eq('id', id)
      .select('*, elemento:obra_elementos(codigo, eje, bloque)')
      .single();

    if (error) throw new Error(error.message);
    return data as unknown as ObraVaciado;
  }

  // ── No Conformidades ───────────────────────────────────────
  async getNoConformidades(proyectoId: string): Promise<ObraNoConformidad[]> {
    const { data, error } = await this.supabase.client
      .from('obra_no_conformidades')
      .select('*')
      .eq('proyecto_id', proyectoId)
      .order('created_at', { ascending: false });

    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as ObraNoConformidad[];
  }

  async crearNC(proyectoId: string, payload: ObraNoConformidadFormData): Promise<ObraNoConformidad> {
    const creadoPor = (await this.supabase.client.auth.getUser()).data.user?.id ?? null;
    const { data, error } = await this.supabase.client
      .from('obra_no_conformidades')
      .insert({ ...payload, proyecto_id: proyectoId, creado_por: creadoPor })
      .select('*')
      .single();

    if (error) throw new Error(error.message);
    return data as unknown as ObraNoConformidad;
  }

  async cerrarNC(id: string): Promise<ObraNoConformidad> {
    const { data, error } = await this.supabase.client
      .from('obra_no_conformidades')
      .update({ estado: 'cerrada', cerrada_en: new Date().toISOString() })
      .eq('id', id)
      .select('*')
      .single();

    if (error) throw new Error(error.message);
    return data as unknown as ObraNoConformidad;
  }
}
