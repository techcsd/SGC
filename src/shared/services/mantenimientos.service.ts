import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';
import { SignedUrlCache } from './signed-url-cache.service';
import { comprimirImagen } from '../utils/comprimir-imagen.util';
import { Mantenimiento, MantenimientoFormData, ProveedorFlota } from '../models/mantenimiento.model';
import { pickColumns } from '../utils/pick-columns.util';

/** BN3 (regla 10) — columnas reales de `sgc.mantenimientos` (verificadas en prod). */
const MANTENIMIENTO_COLS = new Set<string>([
  'vehiculo_id', 'tipo', 'descripcion', 'fecha', 'costo',
  'kilometraje_al_mantenimiento', 'proveedor', 'proveedor_id', 'estado', 'notas', 'fotos',
  'es_prueba', 'incluye_preventivo', 'accidente_id', 'creado_por',
]);

/** CH1 — resultado de validar el km del mantenimiento contra las lecturas del vehículo. */
export interface ValidacionKm {
  ok: boolean;
  nivel: 'ok' | 'aviso' | 'error';
  unidad: string;
  medida_uso: string;
  km_antes: number | null;
  fecha_antes: string | null;
  fuente_antes: string | null;
  km_despues: number | null;
  fecha_despues: string | null;
  fuente_despues: string | null;
  mensaje: string | null;
}

@Injectable({ providedIn: 'root' })
export class MantenimientosService {
  private supabase = inject(SupabaseService);
  private cache = inject(SignedUrlCache);

  /**
   * CD4 — lee por el RPC definer `listar_mantenimientos` (predicado único
   * `puede_ver_vehiculo`, paginado en servidor) en vez de un `select` bajo RLS que
   * hace seq scan con funciones por fila (causa del timeout como Edward). Cada fila ya
   * viene con el embed `vehiculo` y `creado_por_usuario`. `p_limite` topa en 200 server-side.
   */
  async getAll(vehiculoId: string | null = null, limite = 200): Promise<Mantenimiento[]> {
    const { data, error } = await this.supabase.client.rpc('listar_mantenimientos', {
      p_vehiculo: vehiculoId,
      p_limite: limite,
      p_cursor_fecha: null,
      p_cursor_id: null,
    });
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as Mantenimiento[];
  }

  async create(payload: MantenimientoFormData): Promise<Mantenimiento> {
    const { data, error } = await this.supabase.client
      .from('mantenimientos')
      .insert(pickColumns(payload, MANTENIMIENTO_COLS))
      .select('*, vehiculo:vehiculos(placa,marca,modelo), creado_por_usuario:usuarios(nombre)')
      .single();

    if (error) throw new Error(error.message);
    return data as unknown as Mantenimiento;
  }

  async update(id: string, payload: Partial<MantenimientoFormData>): Promise<Mantenimiento> {
    const { data, error } = await this.supabase.client
      .from('mantenimientos')
      .update(pickColumns(payload, MANTENIMIENTO_COLS))
      .eq('id', id)
      .select('*, vehiculo:vehiculos(placa,marca,modelo), creado_por_usuario:usuarios(nombre)')
      .single();

    if (error) throw new Error(error.message);
    return data as unknown as Mantenimiento;
  }

  /**
   * Marca el mantenimiento como completado: resetea el contador de próximo
   * mantenimiento del vehículo (km_ultimo_mantenimiento) y atiende los avisos
   * vencido/pre_cita de ese vehículo. `km` = kilometraje real al que se hizo
   * (si es null, usa el kilometraje_al_mantenimiento del registro).
   */
  async completar(id: string, km: number | null): Promise<void> {
    const { error } = await this.supabase.client.rpc('completar_mantenimiento', {
      p_id: id,
      p_km: km,
    });
    if (error) throw new Error(error.message);
  }

  /**
   * CH1 — valida el km del mantenimiento contra TODAS las lecturas con fecha del
   * vehículo (echadas, inspecciones, entregas, mantenimientos). Devuelve nivel
   * ok|aviso|error + la lectura que choca. `excluir` = id del registro en edición
   * (para no compararse contra sí mismo).
   */
  async validarKm(
    vehiculoId: string,
    km: number,
    fecha: string,
    excluir: string | null = null,
  ): Promise<ValidacionKm | null> {
    const { data, error } = await this.supabase.client.rpc('validar_km_vehiculo', {
      p_vehiculo: vehiculoId,
      p_km: km,
      p_fecha: fecha,
      p_excluir_mant: excluir,
    });
    if (error) throw new Error(error.message);
    return (data ?? null) as ValidacionKm | null;
  }

  /** CH2 — talleres + proveedores visibles para flota (RLS-safe, talleres primero). */
  async getProveedoresFlota(): Promise<ProveedorFlota[]> {
    const { data, error } = await this.supabase.client.rpc('listar_proveedores_para_flota');
    if (error) throw new Error(error.message);
    return (data ?? []) as ProveedorFlota[];
  }

  /** CH3 — cambia el tipo de documento de un adjunto ya guardado. */
  async updateAdjuntoTipo(id: string, tipoDocumento: string, descripcion: string | null = null): Promise<void> {
    const { error } = await this.supabase.client
      .from('mantenimiento_adjuntos')
      .update({ tipo_documento: tipoDocumento, descripcion })
      .eq('id', id);
    if (error) throw new Error(error.message);
  }

  // ── Maintenance photos (sgc.mantenimientos.fotos text[] + `vehiculos` bucket) ──

  /** Uploads one photo for a maintenance record and returns its storage path. */
  async uploadFoto(mantenimientoId: string, file: File): Promise<string> {
    file = await comprimirImagen(file, 'evidencia');
    const safeName = (file.name || 'foto')
      .replace(/\.[^.]+$/, '')
      .replace(/[^a-zA-Z0-9_-]+/g, '-')
      .slice(0, 40) || 'foto';
    const path = `mantenimiento/${mantenimientoId}/${crypto.randomUUID()}-${safeName}.jpg`;
    const { error } = await this.supabase.client.storage
      .from('vehiculos')
      .upload(path, file, { upsert: true });
    if (error) throw new Error(error.message);
    return path;
  }

  /** Resolves a stored photo path to a time-limited signed URL (null on failure). */
  async getFotoUrl(path: string): Promise<string | null> {
    return this.cache.signed('vehiculos', path);
  }

  /** Persists the full list of photo paths on the maintenance row. */
  async setFotos(mantenimientoId: string, fotos: string[]): Promise<void> {
    const { error } = await this.supabase.client
      .from('mantenimientos')
      .update({ fotos })
      .eq('id', mantenimientoId);
    if (error) throw new Error(error.message);
  }

  // ── CG13 — Adjuntos (imágenes + PDFs) en `mantenimiento_adjuntos` ───────────────

  /** Tamaño máximo por adjunto (20 MB). */
  private readonly MAX_ADJUNTO_BYTES = 20 * 1024 * 1024;

  /**
   * CG13 — sube un adjunto (imagen o PDF) del mantenimiento al bucket `vehiculos`
   * conservando la extensión/mime real (los PDFs NO se comprimen ni se fuerzan a
   * `.jpg`; las imágenes sí se comprimen pero quedan como `.jpg`). Luego inserta la
   * fila en `mantenimiento_adjuntos`. Lanza un error amigable si pasa de 20 MB.
   */
  async uploadAdjunto(mantenimientoId: string, file: File, tipoDocumento: string, descripcion: string | null = null): Promise<void> {
    if (file.size > this.MAX_ADJUNTO_BYTES) {
      throw new Error('El archivo supera el límite de 20 MB. Comprime o divide el documento.');
    }
    const nombre = file.name || 'adjunto';
    const esImagen = file.type.startsWith('image/');
    // Las imágenes se recomprimen (perfil documento = legibilidad); los PDFs tal cual.
    const subida = esImagen ? await comprimirImagen(file, 'documento') : file;
    const mime = subida.type || file.type || 'application/octet-stream';

    // Extensión real: jpg para imágenes (ya recomprimidas), la del nombre/mime si no.
    const extNombre = (nombre.match(/\.([a-zA-Z0-9]+)$/)?.[1] ?? '').toLowerCase();
    let ext = esImagen ? 'jpg' : extNombre;
    if (!ext) ext = mime === 'application/pdf' ? 'pdf' : 'bin';

    const base = nombre
      .replace(/\.[^.]+$/, '')
      .replace(/[^a-zA-Z0-9_-]+/g, '-')
      .slice(0, 40) || 'adjunto';
    const path = `mantenimiento/${mantenimientoId}/${crypto.randomUUID()}-${base}.${ext}`;

    const { error: upErr } = await this.supabase.client.storage
      .from('vehiculos')
      .upload(path, subida, { upsert: true, contentType: mime });
    if (upErr) throw new Error(upErr.message);

    // subido_por: id del usuario autenticado (= usuarios.id en esta app) si está.
    const { data: auth } = await this.supabase.client.auth.getUser();
    const { error: insErr } = await this.supabase.client
      .from('mantenimiento_adjuntos')
      .insert({
        mantenimiento_id: mantenimientoId,
        path,
        nombre,
        mime,
        tipo_documento: tipoDocumento,
        descripcion: tipoDocumento === 'otro' ? descripcion : null,
        subido_por: auth?.user?.id ?? null,
      });
    if (insErr) throw new Error(insErr.message);
  }

  /** Resuelve el path de un adjunto a una URL firmada (null si falla). */
  async getAdjuntoUrl(path: string): Promise<string | null> {
    return this.cache.signed('vehiculos', path);
  }

  /** Elimina un adjunto: borra el objeto del storage y la fila. */
  async deleteAdjunto(id: string, path: string): Promise<void> {
    await this.supabase.client.storage.from('vehiculos').remove([path]);
    const { error } = await this.supabase.client
      .from('mantenimiento_adjuntos')
      .delete()
      .eq('id', id);
    if (error) throw new Error(error.message);
  }
}
