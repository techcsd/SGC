import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';
import { SignedUrlCache } from './signed-url-cache.service';
import { DocumentoEntidad, DocumentoFlota } from '../models/documento-flota.model';

const BUCKET = 'flota-documentos';

@Injectable({ providedIn: 'root' })
export class DocumentosFlotaService {
  private supabase = inject(SupabaseService);
  private cache = inject(SignedUrlCache);

  async getByEntidad(entidad: DocumentoEntidad, entidadId: string): Promise<DocumentoFlota[]> {
    const { data, error } = await this.supabase.client
      .from('documentos')
      .select('*')
      .eq('entidad', entidad)
      .eq('entidad_id', entidadId)
      .order('created_at', { ascending: false });

    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as DocumentoFlota[];
  }

  async upload(
    entidad: DocumentoEntidad,
    entidadId: string,
    tipo: string,
    file: File,
    nombre: string | null,
    subidoPor: string | null,
  ): Promise<DocumentoFlota> {
    const path = `${entidad}/${entidadId}/${tipo}/${crypto.randomUUID()}-${file.name}`;
    const { error: uploadError } = await this.supabase.client.storage.from(BUCKET).upload(path, file);
    if (uploadError) throw new Error(uploadError.message);

    const { data, error } = await this.supabase.client
      .from('documentos')
      .insert({
        entidad,
        entidad_id: entidadId,
        tipo,
        nombre: nombre?.trim() || file.name,
        path,
        subido_por: subidoPor,
      })
      .select()
      .single();

    if (error) {
      // Rollback the orphan file if the row insert fails (regla de oro W4: sin huérfanos).
      await this.supabase.client.storage.from(BUCKET).remove([path]);
      throw new Error(error.message);
    }
    return data as unknown as DocumentoFlota;
  }

  /** Inline signed URL for the in-page viewer (browser renders PDFs/images). */
  async getSignedUrl(path: string): Promise<string> {
    return this.cache.signed(BUCKET, path);
  }

  /** Raw bytes so the caller can save them with the original filename. */
  async downloadBlob(path: string): Promise<Blob> {
    const { data, error } = await this.supabase.client.storage.from(BUCKET).download(path);
    if (error) throw new Error(error.message);
    return data;
  }

  async remove(id: string, path: string): Promise<void> {
    await this.supabase.client.storage.from(BUCKET).remove([path]);
    const { error } = await this.supabase.client.from('documentos').delete().eq('id', id);
    if (error) throw new Error(error.message);
  }
}
