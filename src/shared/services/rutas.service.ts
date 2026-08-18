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

  /** Z22.2 / AE5 — paradas (con estado) + conduces + notas de voz de una ruta. */
  async getDetalleTransporte(rutaId: string): Promise<RutaDetalleTransporte> {
    const { data, error } = await this.supabase.client.rpc('ruta_detalle_transporte', {
      p_ruta_id: rutaId,
    });
    if (error) throw new Error(error.message);
    return (data as RutaDetalleTransporte) ?? { paradas: [], conduces: [], notas_voz: [] };
  }

  /** AV13 — cambia el destino por la vía trackeada (sella modificada_at, registra
   *  historial y re-notifica). Acepta las mismas opciones que crear (obra/pin/texto). */
  async cambiarDestino(
    rutaId: string,
    destino: string,
    opts?: { proyectoId?: string | null; lat?: number | null; lng?: number | null },
  ): Promise<void> {
    const { error } = await this.supabase.client.rpc('cambiar_destino_ruta', {
      p_ruta_id: rutaId,
      p_destino: destino,
      p_proyecto_id: opts?.proyectoId ?? null,
      p_lat: opts?.lat ?? null,
      p_lng: opts?.lng ?? null,
    });
    if (error) throw new Error(error.message);
  }

  // ── AE5 — vínculo conduce ↔ parada + avance de parada ────────────────────
  /** Ata un conduce propio a una parada concreta (y a su ruta). null = desvincular. */
  async vincularConduceParada(salidaId: string, rutaParadaId: string | null): Promise<void> {
    const { error } = await this.supabase.client.rpc('vincular_conduce_parada', {
      p_salida_id: salidaId,
      p_ruta_parada_id: rutaParadaId,
    });
    if (error) throw new Error(error.message);
  }

  /** Marca una parada en_camino/entregada/omitida con evidencia opcional (firma AC7-style). */
  async avanzarParada(
    paradaId: string,
    estado: 'en_camino' | 'entregada' | 'omitida' | 'pendiente',
    opts?: { fotoPath?: string | null; firmaPath?: string | null; entregadoA?: string | null; notas?: string | null },
  ): Promise<void> {
    const { error } = await this.supabase.client.rpc('avanzar_parada', {
      p_parada_id: paradaId,
      p_estado: estado,
      p_foto_path: opts?.fotoPath ?? null,
      p_firma_path: opts?.firmaPath ?? null,
      p_entregado_a: opts?.entregadoA ?? null,
      p_notas: opts?.notas ?? null,
    });
    if (error) throw new Error(error.message);
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
  ruta_parada_id: string | null;
  parada_ubicacion: string | null;
  foto_path: string | null;
  entrega_foto_path: string | null;
  recepcion_foto_path: string | null;
  items: RutaConduceItem[];
}
export type ParadaEstado = 'pendiente' | 'en_camino' | 'entregada' | 'omitida';
export interface RutaParadaDetalle {
  id: string;
  orden: number;
  ubicacion: string;
  lat: number | null;
  lng: number | null;
  notas: string | null;
  obra: string | null;
  proyecto_id: string | null;
  estado: ParadaEstado;
  llegada_at: string | null;
  entregada_at: string | null;
  entregado_a: string | null;
  foto_path: string | null;
  firma_path: string | null;
  notas_entrega: string | null;
  conduce_id: string | null;
}
export interface RutaNotaVoz {
  id: string;
  bucket: string;
  path: string;
  duracion_seg: number | null;
  created_at: string;
}
/** AV13 — un evento del historial de la ruta (cambio de destino, parada, etc.). */
export interface RutaEvento {
  tipo: string;
  detalle: string | null;
  por: string | null;
  created_at: string;
}
export interface RutaDetalleTransporte {
  ruta?: { modificada_at?: string | null } | null;
  eventos?: RutaEvento[];
  paradas: RutaParadaDetalle[];
  conduces: RutaConduce[];
  notas_voz: RutaNotaVoz[];
}
