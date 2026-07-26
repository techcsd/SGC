import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';
import { SignedUrlCache } from './signed-url-cache.service';
import { AudioNota, AudioEntidadTipo } from '../models/audio-nota.model';

/**
 * Z23c — Notas de voz transversales. Sube el audio a un bucket privado y lo
 * registra en `sgc.audio_notas` vía RPC (idempotente por path, límite server-side).
 * La reproducción usa URLs firmadas cacheadas (W9 SignedUrlCache).
 *
 * Contrato para PROMPT-2 (app):
 *  - `agregar_audio_nota(p_entidad_tipo, p_entidad_id, p_bucket, p_path, p_duracion_seg, p_tipo_mime, p_tamano_bytes, p_es_prueba)`
 *  - `audios_de(p_entidad_tipo, p_entidad_id)` → filas AudioNota
 *  - `eliminar_audio_nota(p_id)`
 *  Buckets sugeridos: `sgc-bitacora` (bitácora), `flota-documentos` (flota).
 */
@Injectable({ providedIn: 'root' })
export class AudioNotasService {
  private supabase = inject(SupabaseService);
  private cache = inject(SignedUrlCache);

  async list(entidadTipo: AudioEntidadTipo, entidadId: string): Promise<AudioNota[]> {
    const { data, error } = await this.supabase.client.rpc('audios_de', {
      p_entidad_tipo: entidadTipo,
      p_entidad_id: entidadId,
    });
    if (error) throw new Error(error.message);
    return (data ?? []) as AudioNota[];
  }

  /** Sube el audio al bucket y lo registra. Devuelve el id de la nota. */
  async add(
    entidadTipo: AudioEntidadTipo,
    entidadId: string,
    bucket: string,
    blob: Blob,
    opts: { ext?: string; duracionSeg?: number | null; esPrueba?: boolean } = {},
  ): Promise<string> {
    const ext = opts.ext || this.extFromMime(blob.type) || 'webm';
    const path = `audio/${entidadTipo}/${entidadId}/${crypto.randomUUID()}.${ext}`;
    const { error: upErr } = await this.supabase.client.storage
      .from(bucket)
      .upload(path, blob, { upsert: true, contentType: blob.type || 'audio/webm' });
    if (upErr) throw new Error(upErr.message);

    const { data, error } = await this.supabase.client.rpc('agregar_audio_nota', {
      p_entidad_tipo: entidadTipo,
      p_entidad_id: entidadId,
      p_bucket: bucket,
      p_path: path,
      p_duracion_seg: opts.duracionSeg ?? null,
      p_tipo_mime: blob.type || 'audio/webm',
      p_tamano_bytes: blob.size,
      p_es_prueba: opts.esPrueba ?? false,
    });
    if (error) throw new Error(error.message);
    return data as string;
  }

  async remove(id: string): Promise<void> {
    const { error } = await this.supabase.client.rpc('eliminar_audio_nota', { p_id: id });
    if (error) throw new Error(error.message);
  }

  /** URL firmada (cacheada) para reproducir. */
  signedUrl(bucket: string, path: string): Promise<string> {
    return this.cache.signed(bucket, path);
  }

  private extFromMime(mime: string): string | null {
    if (!mime) return null;
    if (mime.includes('webm')) return 'webm';
    if (mime.includes('mp4') || mime.includes('m4a') || mime.includes('aac')) return 'm4a';
    if (mime.includes('mpeg') || mime.includes('mp3')) return 'mp3';
    if (mime.includes('ogg')) return 'ogg';
    if (mime.includes('wav')) return 'wav';
    return null;
  }
}
