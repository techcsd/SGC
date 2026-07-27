import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';
import { Ruta, RutaFormData, RutaEstado } from '../models/ruta.model';
import { sanitizeUuidFields } from '../utils/uuid.util';

/** C2 — uuid opcionales de una ruta a sanear ("null" de <select> → null). */
const RUTA_UUID_FIELDS = ['conductor_id', 'vehiculo_id', 'destino_proyecto_id'] as const;

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
      .insert({ ...sanitizeUuidFields(payload, RUTA_UUID_FIELDS), creado_por: userId })
      .select(SELECT_QUERY)
      .single();

    if (error) throw new Error(error.message);
    return data as unknown as Ruta;
  }

  async update(id: string, payload: Partial<RutaFormData>): Promise<Ruta> {
    const { data, error } = await this.supabase.client
      .from('rutas')
      .update({ ...sanitizeUuidFields(payload, RUTA_UUID_FIELDS), updated_at: new Date().toISOString() })
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

  /** Z22.2 — conduces + notas de voz asociados a una ruta (detalle de transporte). */
  async getDetalleTransporte(rutaId: string): Promise<RutaDetalleTransporte> {
    const { data, error } = await this.supabase.client.rpc('ruta_detalle_transporte', {
      p_ruta_id: rutaId,
    });
    if (error) throw new Error(error.message);
    return (data as RutaDetalleTransporte) ?? { conduces: [], notas_voz: [] };
  }
}

export interface RutaConduceItem {
  articulo: string;
  unidad: string;
  cantidad: number;
  cantidad_recibida: number | null;
  propiedad: string | null;
}
export interface RutaConduce {
  id: string;
  fecha: string;
  estado: string;
  destino: string | null;
  bodega: string | null;
  foto_path: string | null;
  entrega_foto_path: string | null;
  recepcion_foto_path: string | null;
  items: RutaConduceItem[];
}
export interface RutaNotaVoz {
  id: string;
  bucket: string;
  path: string;
  duracion_seg: number | null;
  created_at: string;
}
export interface RutaDetalleTransporte {
  conduces: RutaConduce[];
  notas_voz: RutaNotaVoz[];
}
