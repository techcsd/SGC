import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';
import { SignedUrlCache } from './signed-url-cache.service';
import { comprimirImagen } from '../utils/comprimir-imagen.util';
import {
  Cargo,
  DuplicadoGrupo,
  FirmaLinea,
  FirmaPendienteBandeja,
  FirmaRol,
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
  cuadrilla?: string | null; // AV4 — eje TECNICO
  // CG2 — texto crudo del cargo (TECNICO/OCUPACION): el servidor resuelve/aprende si cargo_id viene null.
  cargo_texto?: string | null;
  // CG2 — vencimiento del permiso de trabajo (haitianos), parseado de OBSERVACION (ISO yyyy-mm-dd).
  permiso_vencimiento?: string | null;
  notas: string | null;
}

/** CG2 — alias de cargo aprendido (texto sucio → cargo del catálogo). */
export interface CargoAlias {
  id: string;
  alias_normalizado: string;
  cargo_id: string;
  cargo_codigo: string | null;
  cargo_nombre: string | null;
  created_at: string;
}

export interface ImportPersonalResultado {
  creados: number;
  actualizados: number;
  saltados?: number;
  bajas?: number;
  errores: { fila: number; documento: string | null; msg: string }[];
}

/** AV4 — diff del import contra el estado actual de la obra. */
export interface ImportPreview {
  altas: { nombre: string; documento_numero: string | null; nacionalidad: string | null; cuadrilla: string | null }[];
  actualizaciones: {
    id: string; documento_numero: string | null;
    antes: { nombre: string; nacionalidad: string | null; cuadrilla: string | null; activo_en_obra: boolean };
    despues: { nombre: string; nacionalidad: string | null; cuadrilla: string | null };
  }[];
  bajas: { id: string; nombre: string; documento_numero: string | null; cuadrilla: string | null }[];
}

/** AV4 — cabecera de un listado importado (historial). */
export interface PersonalListado {
  id: string;
  proyecto_id: string;
  fecha_listado: string | null;
  enc_obra: string | null;
  archivo_nombre: string | null;
  total_altas: number;
  total_actualizados: number;
  total_bajas: number;
  created_at: string;
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

  // ── CG2 — Alias de cargo (resolución confiable + auto-aprendizaje) ──────────
  /** Lista todos los alias de cargo registrados (texto sucio → cargo del catálogo). */
  async listarCargoAlias(): Promise<CargoAlias[]> {
    const { data, error } = await this.client.rpc('listar_cargo_alias');
    if (error) throw new Error(error.message);
    return (data ?? []) as CargoAlias[];
  }

  /** Registra (o actualiza) un alias: el importador "aprende" el texto resuelto a mano. */
  async registrarCargoAlias(alias: string, cargoId: string): Promise<void> {
    const { error } = await this.client.rpc('registrar_cargo_alias', {
      p_alias: alias, p_cargo_id: cargoId,
    });
    if (error) throw new Error(error.message);
  }

  /** Elimina un alias del catálogo (gestión en Proyectos › Cargos). */
  async eliminarCargoAlias(id: string): Promise<void> {
    const { error } = await this.client.rpc('eliminar_cargo_alias', { p_id: id });
    if (error) throw new Error(error.message);
  }

  // ── Listado por obra (RLS filtra la visibilidad por obra) ───────────────────
  async listar(proyectoId?: string): Promise<PersonalObra[]> {
    // CE2 — el nombre de "quién registró" venía por un embed a usuarios bajo RLS que
    // Sonia (abogado) no puede leer → "—". Ahora lo trae un RPC definer con el mismo
    // predicado de visibilidad (puede_ver_personal_obra) + registrado_por_nombre resuelto.
    const { data, error } = await this.client.rpc('listar_personal_obra', {
      p_proyecto: proyectoId ?? null,
    });
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as PersonalObra[];
  }

  /** CE16 — grupos de posibles duplicados (mismo documento, activos). */
  async duplicados(): Promise<DuplicadoGrupo[]> {
    const { data, error } = await this.client.rpc('personal_obra_duplicados');
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as DuplicadoGrupo[];
  }

  /** CE16 — ¿ya existe un trabajador con este documento? (aviso al registrar). */
  async docExiste(tipo: string, numero: string, excluir?: string): Promise<{ id: string; nombre: string; proyecto: string | null }[]> {
    const { data, error } = await this.client.rpc('personal_obra_doc_existe', {
      p_tipo: tipo, p_numero: numero, p_exclude: excluir ?? null,
    });
    if (error) throw new Error(error.message);
    return (data ?? []) as { id: string; nombre: string; proyecto: string | null }[];
  }

  /** CE16 — fusiona dos registros conservando fotos/firmas; descarta el otro en lógico. */
  async fusionar(keep: string, drop: string, motivo?: string): Promise<void> {
    const { error } = await this.client.rpc('fusionar_personal_obra', {
      p_keep: keep, p_drop: drop, p_motivo: motivo ?? null,
    });
    if (error) throw new Error(error.message);
  }

  async getById(id: string): Promise<PersonalObra | null> {
    const { data, error } = await this.client
      .from('personal_obra')
      .select('*, cargo:cargos(id, codigo, nombre), proyecto:proyectos!proyecto_id(nombre, codigo)')
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

  // ── AV4 — Import como CICLO periódico (diff + bajas + historial) ────────────
  /** Previsualiza el diff del listado contra el estado actual (altas/actualizaciones/bajas). */
  async importPreview(proyectoId: string, rows: ImportPersonalRow[]): Promise<ImportPreview> {
    const { data, error } = await this.client.rpc('personal_obra_import_preview', {
      p_proyecto_id: proyectoId, p_rows: rows,
    });
    if (error) throw new Error(error.message);
    return data as ImportPreview;
  }

  /** Importa el listado como ciclo: cabecera + upsert (con cuadrilla) + bajas confirmadas. */
  async importarListado(
    proyectoId: string,
    rows: ImportPersonalRow[],
    lote: string,
    meta: { fecha_listado?: string | null; enc_obra?: string | null; archivo?: string | null },
    bajas: string[],
  ): Promise<ImportPersonalResultado> {
    const { data, error } = await this.client.rpc('importar_listado_personal_obra', {
      p_proyecto_id: proyectoId, p_rows: rows, p_lote: lote,
      p_fecha_listado: meta.fecha_listado ?? null,
      p_enc_obra: meta.enc_obra ?? null,
      p_archivo: meta.archivo ?? null,
      p_bajas: bajas.length ? bajas : null,
    });
    if (error) throw new Error(error.message);
    return data as ImportPersonalResultado;
  }

  /** Historial de listados importados de una obra (trazabilidad). */
  async getListados(proyectoId: string): Promise<PersonalListado[]> {
    const { data, error } = await this.client
      .from('personal_obra_listados')
      .select('*')
      .eq('proyecto_id', proyectoId)
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as PersonalListado[];
  }

  /** AX2 — genera/rota el acceso por cédula + PIN de un capataz (edge acceso-cedula).
   *  Devuelve el email sintético con el que inicia sesión en la app. */
  async generarAccesoCapataz(personalId: string, pin: string): Promise<{ email: string }> {
    const { data, error } = await this.supabase.client.functions.invoke('acceso-cedula', {
      body: { tipo: 'capataz', entityId: personalId, pin },
    });
    if (error) {
      // La edge devuelve { error } en el body con status !=2xx.
      const msg = (data as { error?: string } | null)?.error ?? error.message;
      throw new Error(msg);
    }
    if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
    return data as { email: string };
  }

  async crear(payload: Partial<PersonalObra>): Promise<PersonalObra> {
    const { data, error } = await this.client
      .from('personal_obra')
      .insert(payload)
      .select('*, cargo:cargos(id, codigo, nombre), proyecto:proyectos!proyecto_id(nombre, codigo)')
      .single();
    if (error) throw new Error(error.message);
    return data as unknown as PersonalObra;
  }

  async actualizar(id: string, payload: Partial<PersonalObra>): Promise<PersonalObra> {
    const { data, error } = await this.client
      .from('personal_obra')
      .update(payload)
      .eq('id', id)
      .select('*, cargo:cargos(id, codigo, nombre), proyecto:proyectos!proyecto_id(nombre, codigo)')
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
  async subirFoto(personal: PersonalObra, tipo: FotoTipo, file: File, ext = 'jpg'): Promise<string> {
    // BJ1 — comprimir la foto antes de subir (perfil evidencia), como el resto del
    // repo. Si no es imagen o falla, comprimirImagen devuelve el original.
    file = await comprimirImagen(file, 'evidencia');
    const finalExt = file.type === 'image/jpeg' ? 'jpg' : ext;
    const path = `${personal.proyecto_id}/${personal.id}/${tipo}.${finalExt}`;
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

  /** CE8 — URL firmada de una firma (mismo bucket que las fotos). */
  async firmaUrl(path: string): Promise<string> {
    return this.signedUrls.signed(BUCKET, path);
  }

  // ── CE9 — admin: marcar prueba / eliminar lógico / restaurar / papelera ──────
  async marcarPrueba(id: string, esPrueba: boolean): Promise<void> {
    const { error } = await this.client.rpc('marcar_personal_prueba', { p_id: id, p_es_prueba: esPrueba });
    if (error) throw new Error(error.message);
  }
  async eliminar(id: string, motivo?: string): Promise<void> {
    const { error } = await this.client.rpc('eliminar_personal_obra', { p_id: id, p_motivo: motivo ?? null });
    if (error) throw new Error(error.message);
  }
  async restaurar(id: string): Promise<void> {
    const { error } = await this.client.rpc('restaurar_personal_obra', { p_id: id });
    if (error) throw new Error(error.message);
  }
  async papelera(): Promise<unknown[]> {
    const { data, error } = await this.client.rpc('papelera_personal_obra');
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown[];
  }
  /** CE5 — registra la reimpresión del carnet. */
  async registrarReimpresion(id: string): Promise<void> {
    const { error } = await this.client.rpc('registrar_reimpresion_carnet', { p_id: id });
    if (error) throw new Error(error.message);
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
    opts: {
      plantillaId?: string | null;
      metodo?: 'pad' | 'foto';
      ext?: string;
      // AZ1 — snapshot congelado del documento al firmar.
      valores?: Record<string, string>;
      documentoHtml?: string;
      // CF1 — roles de firma a sembrar además del trabajador.
      rolesFirma?: FirmaRol[];
    } = {},
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
        valores: opts.valores ?? null,
        documento_html: opts.documentoHtml ?? null,
      })
      .select('*')
      .single();
    if (error) throw new Error(error.message);
    const nuevaFirma = data as PersonalFirma;
    // CF1 — sembrar las líneas de firma por rol (empleador siempre; testigos si es contrato).
    const roles = opts.rolesFirma ?? ['empleador'];
    try {
      await this.client.rpc('sembrar_lineas_firma', { p_firma_id: nuevaFirma.id, p_roles: roles });
    } catch { /* no bloquear la firma del trabajador si falla el sembrado */ }
    return nuevaFirma;
  }

  // ── CF1 — líneas de firma por rol (empleador / testigos) ───────────────────
  async lineasFirma(firmaId: string): Promise<FirmaLinea[]> {
    const { data, error } = await this.client.rpc('lineas_firma_documento', { p_firma_id: firmaId });
    if (error) throw new Error(error.message);
    return (data ?? []) as FirmaLinea[];
  }

  /** Registra la firma de una línea (empleador/testigo): pad/foto = digital, fisico = en papel. */
  async firmarLinea(
    firma: PersonalFirma,
    personal: PersonalObra,
    rol: FirmaRol,
    metodo: 'pad' | 'foto' | 'fisico',
    opts: { firma?: Blob | null; nombre?: string | null; cedula?: string | null } = {},
  ): Promise<FirmaLinea> {
    let path: string | null = null;
    if (opts.firma) {
      const ext = metodo === 'fisico' ? (opts.firma.type.includes('pdf') ? 'pdf' : 'jpg') : 'png';
      path = `${personal.proyecto_id}/${personal.id}/firma-${rol}-${Date.now()}.${ext}`;
      const { error: upErr } = await this.client.storage
        .from(BUCKET)
        .upload(path, opts.firma, { upsert: true, contentType: opts.firma.type || 'image/png' });
      if (upErr) throw new Error(upErr.message);
    }
    const { data, error } = await this.client.rpc('firmar_linea_documento', {
      p_firma_id: firma.id,
      p_rol: rol,
      p_metodo: metodo,
      p_firma_path: path,
      p_firmante_nombre: opts.nombre ?? null,
      p_firmante_cedula: opts.cedula ?? null,
    });
    if (error) throw new Error(error.message);
    return data as FirmaLinea;
  }

  /** CF1 — bandeja de firmas pendientes (Legal). */
  async firmasPendientes(): Promise<FirmaPendienteBandeja[]> {
    const { data, error } = await this.client.rpc('firmas_pendientes_legal');
    if (error) throw new Error(error.message);
    return (data ?? []) as FirmaPendienteBandeja[];
  }

  // ── Conteos por obra (para la vista del proyecto) ──────────────────────────
  async conteos(proyectoId: string): Promise<PersonalConteos | null> {
    const { data, error } = await this.client.rpc('personal_obra_conteos', { p_proyecto_id: proyectoId });
    if (error) throw new Error(error.message);
    if (!data || Object.keys(data).length === 0) return null;
    return data as PersonalConteos;
  }
}
