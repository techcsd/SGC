import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';
import { Ruta, RutaFormData, RutaEstado } from '../models/ruta.model';

const SELECT_QUERY =
  '*, vehiculo:vehiculos(placa, marca, modelo), conductor:conductores(nombre), destino_proyecto:proyectos!destino_proyecto_id(nombre, latitud, longitud)';

@Injectable({ providedIn: 'root' })
export class RutasService {
  private supabase = inject(SupabaseService);

  async getAll(): Promise<Ruta[]> {
    const { data, error } = await this.supabase.client
      .from('rutas')
      .select(SELECT_QUERY)
      .order('fecha', { ascending: false });

    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as Ruta[];
  }

  async create(payload: RutaFormData, userId: string | null): Promise<Ruta> {
    const { data, error } = await this.supabase.client
      .from('rutas')
      .insert({ ...payload, creado_por: userId })
      .select(SELECT_QUERY)
      .single();

    if (error) throw new Error(error.message);
    return data as unknown as Ruta;
  }

  async update(id: string, payload: Partial<RutaFormData>): Promise<Ruta> {
    const { data, error } = await this.supabase.client
      .from('rutas')
      .update({ ...payload, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select(SELECT_QUERY)
      .single();

    if (error) throw new Error(error.message);
    return data as unknown as Ruta;
  }

  async registrarReal(
    id: string,
    payload: { km_real: number | null; tiempo_real_min: number | null; estado: RutaEstado },
  ): Promise<Ruta> {
    const { data, error } = await this.supabase.client
      .from('rutas')
      .update({ ...payload, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select(SELECT_QUERY)
      .single();

    if (error) throw new Error(error.message);
    return data as unknown as Ruta;
  }
}
