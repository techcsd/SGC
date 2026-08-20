import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';
import { SignedUrlCache } from './signed-url-cache.service';
import {
  Cargo,
  FotoTipo,
  PersonalConteos,
  PersonalFirma,
  PersonalFoto,
  PersonalObra,
} from '../models/personal-obra.model';

const BUCKET = 'personal-obra';

/** AT5 — fila normalizada lista para importar (contrato del RPC importar_personal_obra). */
export interface ImportPersonalRow {
  nombre: string;
  apellido: string | null;
  nacionalidad: string;
  tipo_documento: string;
  documento_numero: string | null;
  cargo_id: string | null;
  notas: string | null;
}

export interface ImportPersonalResultado {
  creados: number;
  actualizados: number;
  saltados: number;
  errores: { fila: number; documento: string | null; msg: string }[];
}

/** AR1 — Registro de Personal de obra (CRUD + evidencia fotográfica + firma + carnet). */
@Injectable({ providedIn: 'root' })
export class PersonalObraService {
  private supabase = inject(SupabaseService);
  private signedUrls = inject(SignedUrlCache);

  private get client() {
    return this.supabase.client;
  }

  // ── Catálogo de cargos (referencia) ────────────────────────────────────────
  async getCargos(): Promise<Cargo[]> {
    const { data, error } = await this.client
      .from('cargos')
      .select('*')
      .eq('activo', true)
      .order('orden');
    if (error) throw new Error(error.message);
    return (data ?? []) as Cargo[];
  }

  // ── Listado por obra (RLS filtra la visibilidad por obra) ───────────────────
  async listar(proyectoId?: string): Promise<PersonalObra[]> {
    let q = this.client
      .from('personal_obra')
      .select('*, cargo:cargos(id, codigo, nombre), proyecto:proyectos(nombre, codigo)')
      .order('created_at', { ascending: false });
    if (proyectoId) q = q.eq('proyecto_id', proyectoId);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as PersonalObra[];
  }

  async getById(id: string): Promise<PersonalObra | null> {
    const { data, error } = await this.client
      .from('personal_obra')
      .select('*, cargo:cargos(id, codigo, nombre), proyecto:proyectos(nombre, codigo)')
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (data ?? null) as unknown as PersonalObra | null;
  }

  // ── AT5 — Import desde Excel (atómico, dedupe por documento, con deshacer) ──
  /** Importa filas de personal a una obra. Devuelve el resumen del lote. */
  async importar(
    proyectoId: string,
    rows: ImportPersonalRow[],
    lote: string,
    modo: 'actualizar' | 'saltar',
  ): Promise<ImportPersonalResultado> {
    const { data, error } = await this.client.rpc('importar_personal_obra', {
      p_proyecto_id: proyectoId, p_rows: rows, p_lote: lote, p_modo: modo,
    });
    if (error) throw new Error(error.message);
    return data as ImportPersonalResultado;
  }

  /** Deshace un lote de import (elimina las filas creadas por ese lote). */
  async deshacerLote(lote: string): Promise<number> {
    const { data, error } = await this.client.rpc('deshacer_lote_personal', { p_lote: lote });
    if (error) throw new Error(error.message);
    return (data ?? 0) as number;
  }

  async crear(payload: Partial<PersonalObra>): Promise<PersonalObra> {
    const { data, error } = await this.client
      .from('personal_obra')
      .insert(payload)
      .select('*, cargo:cargos(id, codigo, nombre), proyecto:proyectos(nombre, codigo)')
      .single();
    if (error) throw new Error(error.message);
    return data as unknown as PersonalObra;
  }

  async actualizar(id: string, payload: Partial<PersonalObra>): Promise<PersonalObra> {
    const { data, error } = await this.client
      .from('personal_obra')
      .update(payload)
      .eq('id', id)
      .select('*, cargo:cargos(id, codigo, nombre), proyecto:proyectos(nombre, codigo)')
      .single();
    if (error) throw new Error(error.message);
    return data as unknown as PersonalObra;
  }

  /** Emite (o reemite) el carnet: número único CSD-######. Devuelve el número. */
  async emitirCarnet(id: string): Promise<string> {
    const { data, error } = await this.client.rpc('emitir_carnet_personal', { p_id: id });
    if (error) throw new Error(error.message);
    return data as string;
  }

  // ── Fotos de evidencia ──────────────────────────────────────────────────────
  async getFotos(personalId: string): Promise<PersonalFoto[]> {
    const { data, error } = await this.client
      .from('personal_obra_fotos')
      .select('*')
      .eq('personal_id', personalId);
    if (error) throw new Error(error.message);
    return (data ?? []) as PersonalFoto[];
  }

  /** Sube una foto tipada al bucket y registra/actualiza su fila (una por tipo). */
  async subirFoto(personal: PersonalObra, tipo: FotoTipo, file: Blob, ext = 'jpg'): Promise<string> {
    const path = `${personal.proyecto_id}/${personal.id}/${tipo}.${ext}`;
    const { error: upErr } = await this.client.storage
      .from(BUCKET)
      .upload(path, file, { upsert: true, contentType: file.type || 'image/jpeg' });
    if (upErr) throw new Error(upErr.message);
    const { error } = await this.client
      .from('personal_obra_fotos')
      .upsert({ personal_id: personal.id, tipo, foto_path: path }, { onConflict: 'personal_id,tipo' });
    if (error) throw new Error(error.message);
    return path;
  }

  async fotoUrl(path: string, thumb = false): Promise<string> {
    return this.signedUrls.signed(BUCKET, path, thumb ? { width: 320, quality: 70 } : undefined);
  }

  // ── Firma de documento(s) ──────────────────────────────────────────────────
  async getFirmas(personalId: string): Promise<PersonalFirma[]> {
    const { data, error } = await this.client
      .from('personal_obra_firmas')
      .select('*')
      .eq('personal_id', personalId)
      .order('firmado_at', { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as PersonalFirma[];
  }

  /** Sube el PNG de la firma y registra el documento firmado. */
  async registrarFirma(
    personal: PersonalObra,
    documentoNombre: string,
    firma: Blob,
    opts: { plantillaId?: string | null; metodo?: 'pad' | 'foto'; ext?: string } = {},
  ): Promise<PersonalFirma> {
    const ext = opts.ext ?? 'png';
    const path = `${personal.proyecto_id}/${personal.id}/firma-${Date.now()}.${ext}`;
    const { error: upErr } = await this.client.storage
      .from(BUCKET)
      .upload(path, firma, { upsert: true, contentType: firma.type || 'image/png' });
    if (upErr) throw new Error(upErr.message);
    const { data, error } = await this.client
      .from('personal_obra_firmas')
      .insert({
        personal_id: personal.id,
        documento_nombre: documentoNombre,
        firma_path: path,
        plantilla_id: opts.plantillaId ?? null,
        metodo: opts.metodo ?? 'pad',
      })
      .select('*')
      .single();
    if (error) throw new Error(error.message);
    return data as PersonalFirma;
  }

  // ── Conteos por obra (para la vista del proyecto) ──────────────────────────
  async conteos(proyectoId: string): Promise<PersonalConteos | null> {
    const { data, error } = await this.client.rpc('personal_obra_conteos', { p_proyecto_id: proyectoId });
    if (error) throw new Error(error.message);
    if (!data || Object.keys(data).length === 0) return null;
    return data as PersonalConteos;
  }
}
