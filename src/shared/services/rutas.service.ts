import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';
import { Ruta, RutaFormData, RutaEstado, RutaParada, RutaFoto } from '../models/ruta.model';
import { sanitizeUuidFields } from '../utils/uuid.util';
import { SignedUrlCache } from './signed-url-cache.service';
import { comprimirImagen } from '../utils/comprimir-imagen.util';

/** C2 — uuid opcionales de una ruta a sanear ("null" de <select> → null). */
const RUTA_UUID_FIELDS = ['conductor_id', 'vehiculo_id', 'destino_proyecto_id'] as const;

const SELECT_QUERY =
  '*, vehiculo:vehiculos(placa, marca, modelo), conductor:conductores(nombre), destino_proyecto:proyectos!destino_proyecto_id(nombre, latitud, longitud)';

@Injectable({ providedIn: 'root' })
export class RutasService {
  private supabase = inject(SupabaseService);
  private cache = inject(SignedUrlCache);

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

  // ── AC13 — Paradas intermedias (multi-stop) ──────────────────────────────
  /** Paradas de una ruta, en orden. */
  async getParadas(rutaId: string): Promise<RutaParada[]> {
    const { data, error } = await this.supabase.client
      .from('ruta_paradas')
      .select('id, ruta_id, orden, ubicacion, lat, lng, notas, proyecto_id')
      .eq('ruta_id', rutaId)
      .order('orden', { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as RutaParada[];
  }

  /** Reemplaza TODAS las paradas de una ruta con el arreglo ordenado dado (RPC). */
  async setParadas(rutaId: string, paradas: RutaParada[]): Promise<number> {
    const p_paradas = paradas.map((p, i) => ({
      orden: i + 1,
      ubicacion: p.ubicacion,
      lat: p.lat ?? null,
      lng: p.lng ?? null,
      notas: p.notas ?? null,
      proyecto_id: p.proyecto_id ?? null,
    }));
    const { data, error } = await this.supabase.client.rpc('set_ruta_paradas', {
      p_ruta_id: rutaId,
      p_paradas,
    });
    if (error) throw new Error(error.message);
    return (data as number) ?? p_paradas.length;
  }

  // ── AC6 — Fotos de evidencia de la ruta (bucket `vehiculos`) ──────────────
  /** Comprime, sube al bucket `vehiculos` (ruta/{id}/{uuid}.jpg) e inserta la fila. */
  async uploadRutaFoto(rutaId: string, file: File, momento = 'inicial'): Promise<RutaFoto> {
    const comprimida = await comprimirImagen(file);
    const path = `ruta/${rutaId}/${crypto.randomUUID()}.jpg`;
    const { error: upErr } = await this.supabase.client.storage
      .from('vehiculos')
      .upload(path, comprimida);
    if (upErr) throw new Error(upErr.message);
    const { data, error } = await this.supabase.client
      .from('ruta_fotos')
      .insert({ ruta_id: rutaId, momento, storage_path: path })
      .select('id, ruta_id, momento, storage_path, orden')
      .single();
    if (error) throw new Error(error.message);
    return data as unknown as RutaFoto;
  }

  /** Fotos de una ruta con su URL firmada (cache W9). */
  async getRutaFotos(rutaId: string): Promise<(RutaFoto & { url: string })[]> {
    const { data, error } = await this.supabase.client
      .from('ruta_fotos')
      .select('id, ruta_id, momento, storage_path, orden')
      .eq('ruta_id', rutaId)
      .order('orden', { ascending: true });
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as unknown as RutaFoto[];
    return Promise.all(
      rows.map(async (f) => ({
        ...f,
        url: await this.cache.signed('vehiculos', f.storage_path, { width: 400, quality: 75 }),
      })),
    );
  }

  /** URL firmada (original) de una foto de ruta — para el lightbox. */
  async getRutaFotoUrl(path: string): Promise<string> {
    return this.cache.signed('vehiculos', path);
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
