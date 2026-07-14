import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';
import {
  ClPlantilla,
  ClPlantillaItem,
  ClRegistro,
  ClRegistroFormData,
  ClRegistroItem,
  ClRegistroFirma,
} from '../models/cl-liberacion.model';

/**
 * CSD-OPE-01 §6.8/§9 — Checklists de Liberación (CL-01..07).
 * El cliente de Supabase ya está fijado al schema `sgc`. La media (plano, fotos,
 * firmas) vive en el bucket privado `obra`; se sirve con URLs firmadas temporales.
 * Cuando las firmas incluyen residente+responsable+cliente, un trigger marca el
 * registro como 'firmado' y habilita la liberación del vaciado asociado.
 */
@Injectable({ providedIn: 'root' })
export class ClLiberacionService {
  private supabase = inject(SupabaseService);
  private readonly BUCKET = 'obra';

  // ── Plantillas ─────────────────────────────────────────────
  async getPlantillas(): Promise<ClPlantilla[]> {
    const { data, error } = await this.supabase.client
      .from('cl_plantillas')
      .select('*')
      .eq('activo', true)
      .order('orden', { ascending: true })
      .order('codigo', { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as ClPlantilla[];
  }

  async getPlantillaItems(plantillaId: string): Promise<ClPlantillaItem[]> {
    const { data, error } = await this.supabase.client
      .from('cl_plantilla_items')
      .select('*')
      .eq('plantilla_id', plantillaId)
      .order('orden', { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as ClPlantillaItem[];
  }

  // ── Registros ──────────────────────────────────────────────
  async getRegistros(proyectoId: string): Promise<ClRegistro[]> {
    const { data, error } = await this.supabase.client
      .from('cl_registros')
      .select(
        '*, plantilla:cl_plantillas(codigo,nombre), items:cl_registro_items(*), fotos:cl_registro_fotos(*), firmas:cl_registro_firmas(*)',
      )
      .eq('proyecto_id', proyectoId)
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as ClRegistro[];
  }

  /** Crea un CL en borrador junto con sus ítems (cumple/comentario por punto). */
  async crearRegistro(
    proyectoId: string,
    form: ClRegistroFormData,
    items: ClRegistroItem[],
    planoPath: string | null,
  ): Promise<ClRegistro> {
    const creadoPor = (await this.supabase.client.auth.getUser()).data.user?.id ?? null;
    const { data: reg, error } = await this.supabase.client
      .from('cl_registros')
      .insert({
        proyecto_id: proyectoId,
        plantilla_id: form.plantilla_id,
        elemento_id: form.elemento_id,
        vaciado_id: form.vaciado_id,
        bloque: form.bloque,
        eje: form.eje,
        plano_path: planoPath,
        observaciones: form.observaciones,
        creado_por: creadoPor,
      })
      .select('*')
      .single();
    if (error) throw new Error(error.message);
    const registro = reg as unknown as ClRegistro;

    if (items.length) {
      const rows = items.map((i, idx) => ({
        registro_id: registro.id,
        etiqueta: i.etiqueta,
        seccion: i.seccion,
        cumple: i.cumple,
        comentario: i.comentario,
        orden: i.orden ?? idx,
      }));
      const { error: itErr } = await this.supabase.client.from('cl_registro_items').insert(rows);
      if (itErr) throw new Error(itErr.message);
    }
    return this.getRegistro(registro.id);
  }

  async getRegistro(id: string): Promise<ClRegistro> {
    const { data, error } = await this.supabase.client
      .from('cl_registros')
      .select(
        '*, plantilla:cl_plantillas(codigo,nombre), items:cl_registro_items(*), fotos:cl_registro_fotos(*), firmas:cl_registro_firmas(*)',
      )
      .eq('id', id)
      .single();
    if (error) throw new Error(error.message);
    return data as unknown as ClRegistro;
  }

  async updateObservaciones(id: string, observaciones: string | null): Promise<void> {
    const { error } = await this.supabase.client
      .from('cl_registros')
      .update({ observaciones })
      .eq('id', id);
    if (error) throw new Error(error.message);
  }

  // ── Firmas (ciclo del procedimiento) ───────────────────────
  /** Añade una firma; el trigger recalcula el estado del registro. */
  async addFirma(
    registroId: string,
    rol: string,
    nombre: string | null,
    firmaPath: string | null,
    orden: number,
  ): Promise<ClRegistroFirma> {
    const usuarioId = (await this.supabase.client.auth.getUser()).data.user?.id ?? null;
    const { data, error } = await this.supabase.client
      .from('cl_registro_firmas')
      .insert({
        registro_id: registroId,
        rol,
        usuario_id: usuarioId,
        nombre,
        firma_path: firmaPath,
        orden,
      })
      .select('*')
      .single();
    if (error) throw new Error(error.message);
    return data as unknown as ClRegistroFirma;
  }

  // ── Fotos ──────────────────────────────────────────────────
  async addFoto(
    registroId: string,
    storagePath: string,
    correcto: boolean | null,
    descripcion: string | null,
  ): Promise<void> {
    const { error } = await this.supabase.client.from('cl_registro_fotos').insert({
      registro_id: registroId,
      storage_path: storagePath,
      correcto,
      descripcion,
    });
    if (error) throw new Error(error.message);
  }

  // ── Storage (bucket privado `obra`) ────────────────────────
  /** Sube un archivo y devuelve su ruta en el bucket. */
  async upload(registroId: string, kind: 'plano' | 'foto' | 'firma', file: Blob, ext = 'jpg'): Promise<string> {
    const path = `cl/${registroId}/${kind}/${crypto.randomUUID()}.${ext}`;
    const { error } = await this.supabase.client.storage
      .from(this.BUCKET)
      .upload(path, file, { upsert: true });
    if (error) throw new Error(error.message);
    return path;
  }

  /** Sube el plano/foto/firma antes de tener el id del registro (carpeta 'tmp'). */
  async uploadTmp(kind: 'plano' | 'foto' | 'firma', file: Blob, ext = 'jpg'): Promise<string> {
    const path = `cl/tmp/${kind}/${crypto.randomUUID()}.${ext}`;
    const { error } = await this.supabase.client.storage
      .from(this.BUCKET)
      .upload(path, file, { upsert: true });
    if (error) throw new Error(error.message);
    return path;
  }

  async getUrl(path: string): Promise<string | null> {
    if (!path) return null;
    const { data, error } = await this.supabase.client.storage
      .from(this.BUCKET)
      .createSignedUrl(path, 3600);
    if (error) return null;
    return data.signedUrl;
  }
}
