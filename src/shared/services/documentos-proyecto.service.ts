import { Injectable, inject } from '@angular/core';
import * as mammoth from 'mammoth';
import { SupabaseService } from '../../app/core/services/supabase.service';
import { DocumentoProyecto, DocumentoTipo } from '../models/documento-proyecto.model';

const BUCKET = 'sgc-documentos';

@Injectable({ providedIn: 'root' })
export class DocumentosProyectoService {
  private supabase = inject(SupabaseService);

  async getByProyecto(proyectoId: string): Promise<DocumentoProyecto[]> {
    const { data, error } = await this.supabase.client
      .from('documentos_proyecto')
      .select('*')
      .eq('proyecto_id', proyectoId)
      .order('created_at', { ascending: false });

    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as DocumentoProyecto[];
  }

  /** Uploads a file and, for .docx manuals, parses its content client-side into readable HTML. */
  async upload(
    proyectoId: string,
    tipo: DocumentoTipo,
    file: File,
    subidoPor: string | null,
  ): Promise<DocumentoProyecto> {
    const path = `${proyectoId}/${tipo}/${crypto.randomUUID()}-${file.name}`;
    const { error: uploadError } = await this.supabase.client.storage.from(BUCKET).upload(path, file);
    if (uploadError) throw new Error(uploadError.message);

    let contenidoHtml: string | null = null;
    if (file.name.toLowerCase().endsWith('.docx')) {
      try {
        const buffer = await file.arrayBuffer();
        const result = await mammoth.convertToHtml({ arrayBuffer: buffer });
        contenidoHtml = result.value;
      } catch {
        // if parsing fails, the file is still stored and viewable/downloadable as-is
      }
    }

    const { data, error } = await this.supabase.client
      .from('documentos_proyecto')
      .insert({
        proyecto_id: proyectoId,
        tipo,
        nombre: file.name,
        archivo_path: path,
        tipo_mime: file.type || null,
        contenido_html: contenidoHtml,
        subido_por: subidoPor,
      })
      .select()
      .single();

    if (error) throw new Error(error.message);
    return data as unknown as DocumentoProyecto;
  }

  /** Inline URL for the in-page viewer (browser renders PDFs/images directly). */
  async getSignedUrl(path: string): Promise<string> {
    const { data, error } = await this.supabase.client.storage.from(BUCKET).createSignedUrl(path, 3600);
    if (error) throw new Error(error.message);
    return data.signedUrl;
  }

  /** Downloads the raw bytes so the caller can save them with the original
   *  filename. Goes through the authenticated client (not a signed URL), which
   *  sidesteps cross-origin download-attribute quirks entirely. */
  async downloadBlob(path: string): Promise<Blob> {
    const { data, error } = await this.supabase.client.storage.from(BUCKET).download(path);
    if (error) throw new Error(error.message);
    return data;
  }

  async remove(id: string, path: string): Promise<void> {
    await this.supabase.client.storage.from(BUCKET).remove([path]);
    const { error } = await this.supabase.client.from('documentos_proyecto').delete().eq('id', id);
    if (error) throw new Error(error.message);
  }
}
