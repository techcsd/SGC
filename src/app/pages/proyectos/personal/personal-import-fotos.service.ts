import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../../core/services/supabase.service';
import { PersonalObraService } from '../../../../shared/services/personal-obra.service';
import { PrivacidadService } from '../../../../shared/services/privacidad.service';
import { PersonalObra } from '../../../../shared/models/personal-obra.model';
import { comprimirImagen } from '../../../../shared/utils/comprimir-imagen.util';
import { edgeErrorDetail } from '../../../../shared/utils/edge.util';
import {
  AnclaFilas, FotoTipoDestino, LecturaCedula, MAX_IMAGENES_LOTE, procesarConConcurrencia,
} from './personal-import-fotos.util';
import {
  EXT_IMAGEN, esEntradaImagenZip, mapearRid, mimeDeNombre, parsearAnclajes, rutaDrawingDeHoja, rutaPrimeraHoja, rutaRels,
} from './personal-import-xlsx-imagenes.util';

/** EA2 — límites del lote (navegador). */
export const LIMITES_FOTOS = {
  maxZipBytes: 200 * 1024 * 1024,
  maxImagenBytes: 15 * 1024 * 1024, // = límite del bucket personal-obra
  maxTotalBytes: 600 * 1024 * 1024, // descomprimido, suma de imágenes
  maxImagenes: MAX_IMAGENES_LOTE,
};

const BUCKET = 'personal-obra';

/** Una imagen candidata del lote (todavía NO subida al expediente). */
export interface ImagenLote {
  id: string;
  file: File;
  origen: 'archivo' | 'zip' | 'xlsx';
  nombreArchivo: string;
  ancla: AnclaFilas | null;
  hash: string;
}

export interface ResultadoExtraccion { imagenes: ImagenLote[]; omitidas: { nombre: string; motivo: string }[] }

/** Error de lectura de UNA imagen. `fatal` = no tiene sentido seguir con el resto del lote. */
export class ErrorLectura extends Error {
  constructor(mensaje: string, public codigo?: string, public fatal = false) { super(mensaje); }
}
const CODIGOS_FATALES = new Set(['sin_consentimiento_ia', 'no_auth', 'sesion_invalida', 'limite_hora', 'limite_diario', 'ia_sin_credito', 'ia_modelo_no_disponible']);
const CODIGOS_REINTENTABLES = new Set(['transporte', 'ia_limite', 'ia_tiempo_agotado', 'ia_error']);

export interface RespuestaLectura { lectura: LecturaCedula; confianzaMin: number }

export interface ItemSubida { fotoId: string; personal: PersonalObra; tipo: FotoTipoDestino; file: File }
export interface FotoSubida { fotoId: string; personalId: string; tipo: FotoTipoDestino; path: string }
export interface ResultadoSubida {
  subidas: FotoSubida[];
  omitidas: { fotoId: string; motivo: string }[];
  fallidas: { fotoId: string; msg: string }[];
}

const uid = () => crypto.randomUUID();

/**
 * EA2 — fotos del personal de obra por lote (ZIP / imágenes sueltas / incrustadas en el .xlsx):
 * extracción en el navegador, lectura con IA UNA imagen por llamada (edge leer-cedulas-lote) y
 * subida al expediente (bucket privado) SOLO tras confirmar el import.
 */
@Injectable({ providedIn: 'root' })
export class PersonalImportFotosService {
  private supabase = inject(SupabaseService);
  private personalSvc = inject(PersonalObraService);
  private privacidad = inject(PrivacidadService);

  /** ¿Dio su consentimiento de IA? (la edge lo vuelve a verificar en el servidor). */
  async tieneConsentimientoIa(): Promise<boolean> {
    try { return await this.privacidad.miConsentimiento('ia'); } catch { return false; }
  }

  // ── Extracción ────────────────────────────────────────────────────────────
  async hash(file: Blob): Promise<string> {
    const buf = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
    return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  private async nueva(file: File, origen: ImagenLote['origen'], ancla: AnclaFilas | null): Promise<ImagenLote> {
    return { id: uid(), file, origen, nombreArchivo: file.name, ancla, hash: await this.hash(file) };
  }

  /** Imágenes sueltas arrastradas (un .zip entre ellas se descomprime). Filtra no-imágenes y tamaños. */
  async desdeArchivos(files: File[]): Promise<ResultadoExtraccion> {
    const imagenes: ImagenLote[] = [];
    const omitidas: ResultadoExtraccion['omitidas'] = [];
    for (const f of files) {
      if (/\.zip$/i.test(f.name) || f.type === 'application/zip' || f.type === 'application/x-zip-compressed') {
        const r = await this.desdeZip(f);
        imagenes.push(...r.imagenes); omitidas.push(...r.omitidas);
        continue;
      }
      if (!(f.type.startsWith('image/') || EXT_IMAGEN.test(f.name))) { omitidas.push({ nombre: f.name, motivo: 'No es una imagen' }); continue; }
      if (f.size > LIMITES_FOTOS.maxImagenBytes) { omitidas.push({ nombre: f.name, motivo: 'Pesa más de 15 MB' }); continue; }
      imagenes.push(await this.nueva(f, 'archivo', null));
    }
    return { imagenes, omitidas };
  }

  /** Descomprime un ZIP en el navegador con límites (tamaño del zip, nº de imágenes, tamaño por imagen y total). */
  async desdeZip(zipFile: File): Promise<ResultadoExtraccion> {
    const imagenes: ImagenLote[] = [];
    const omitidas: ResultadoExtraccion['omitidas'] = [];
    if (zipFile.size > LIMITES_FOTOS.maxZipBytes) {
      return { imagenes, omitidas: [{ nombre: zipFile.name, motivo: 'El ZIP pesa más de 200 MB' }] };
    }
    const JSZip = (await import('jszip')).default;
    let zip;
    try { zip = await JSZip.loadAsync(await zipFile.arrayBuffer()); } catch {
      return { imagenes, omitidas: [{ nombre: zipFile.name, motivo: 'ZIP dañado o no válido' }] };
    }
    let total = 0;
    for (const [nombre, entrada] of Object.entries(zip.files)) {
      if (entrada.dir || !esEntradaImagenZip(nombre)) continue;
      if (imagenes.length >= LIMITES_FOTOS.maxImagenes) { omitidas.push({ nombre, motivo: 'Se superó el máximo de imágenes por lote' }); continue; }
      // Tamaño declarado (defensa contra zip-bombs: no se descomprime lo que ya excede el tope).
      const declarado = (entrada as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize;
      if (typeof declarado === 'number' && (declarado > LIMITES_FOTOS.maxImagenBytes || total + declarado > LIMITES_FOTOS.maxTotalBytes)) {
        omitidas.push({ nombre, motivo: declarado > LIMITES_FOTOS.maxImagenBytes ? 'Pesa más de 15 MB' : 'Se superó el tamaño total del lote' });
        continue;
      }
      const blob = await entrada.async('blob');
      if (blob.size > LIMITES_FOTOS.maxImagenBytes || total + blob.size > LIMITES_FOTOS.maxTotalBytes) {
        omitidas.push({ nombre, motivo: 'Pesa demasiado' });
        continue;
      }
      total += blob.size;
      const base = nombre.split('/').pop() ?? nombre;
      imagenes.push(await this.nueva(new File([blob], base, { type: mimeDeNombre(base) }), 'zip', null));
    }
    return { imagenes, omitidas };
  }

  /**
   * Imágenes incrustadas en el .xlsx: hoja 1 → drawing → anclaje (fila) + `xl/media/*`. Si no hay drawing con
   * anclajes pero sí `xl/media`, se devuelven sin fila (la IA decide). Nunca lanza: un .xls viejo o un xlsx
   * raro simplemente no aporta imágenes.
   */
  async desdeXlsx(buf: ArrayBuffer): Promise<ResultadoExtraccion> {
    const imagenes: ImagenLote[] = [];
    const omitidas: ResultadoExtraccion['omitidas'] = [];
    try {
      const JSZip = (await import('jszip')).default;
      const zip = await JSZip.loadAsync(buf);
      const leer = async (ruta: string) => zip.file(ruta)?.async('string') ?? null;
      const usadas = new Set<string>();
      let total = 0;
      const agregar = async (ruta: string, ancla: AnclaFilas | null) => {
        const entrada = zip.file(ruta);
        if (!entrada || usadas.has(`${ruta}|${ancla?.desde ?? ''}`)) return;
        usadas.add(`${ruta}|${ancla?.desde ?? ''}`);
        if (imagenes.length >= LIMITES_FOTOS.maxImagenes) { omitidas.push({ nombre: ruta, motivo: 'Se superó el máximo de imágenes por lote' }); return; }
        const blob = await entrada.async('blob');
        if (blob.size > LIMITES_FOTOS.maxImagenBytes || total + blob.size > LIMITES_FOTOS.maxTotalBytes) { omitidas.push({ nombre: ruta, motivo: 'Pesa demasiado' }); return; }
        total += blob.size;
        const base = ruta.split('/').pop() ?? ruta;
        imagenes.push(await this.nueva(new File([blob], base, { type: mimeDeNombre(base) }), 'xlsx', ancla));
      };

      const wb = await leer('xl/workbook.xml');
      const wbRels = await leer('xl/_rels/workbook.xml.rels');
      const hoja = wb && wbRels ? rutaPrimeraHoja(wb, wbRels) : null;
      const hojaRels = hoja ? await leer(rutaRels(hoja)) : null;
      const drawing = hoja && hojaRels ? rutaDrawingDeHoja(hoja, hojaRels) : null;
      const drawingXml = drawing ? await leer(drawing) : null;
      const drawingRels = drawing ? await leer(rutaRels(drawing)) : null;
      if (drawing && drawingXml && drawingRels) {
        const rids = mapearRid(drawing, drawingRels);
        for (const a of parsearAnclajes(drawingXml)) {
          const ruta = rids.get(a.rid);
          if (ruta) await agregar(ruta, a.ancla);
        }
      }
      // Respaldo: imágenes en xl/media que ningún anclaje de la hoja 1 reclamó (p. ej. otras hojas o «imagen en celda»).
      if (!imagenes.length) {
        for (const ruta of Object.keys(zip.files)) {
          if (/^xl\/media\//i.test(ruta) && EXT_IMAGEN.test(ruta)) await agregar(ruta, null);
        }
      }
    } catch { /* un xlsx sin imágenes (o un .xls) simplemente no aporta */ }
    return { imagenes, omitidas };
  }

  // ── Lectura con IA (una imagen por llamada) ─────────────────────────────────
  private async aBase64(file: Blob): Promise<string> {
    const bytes = new Uint8Array(await file.arrayBuffer());
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }

  /** Lee UNA imagen. Reintenta fallos transitorios (red/IA ocupada) una vez; lanza `ErrorLectura` (con `fatal` si el lote no debe seguir). */
  async leerCedula(file: File): Promise<RespuestaLectura> {
    // Copia comprimida SOLO para la lectura (2000 px, legible); el original sube después al expediente.
    const reducida = await comprimirImagen(file, 'documento');
    const mime = reducida.type || mimeDeNombre(reducida.name);
    const imagen = { data: await this.aBase64(reducida), mime };
    let ultimo: ErrorLectura | null = null;
    for (let intento = 0; intento < 2; intento++) {
      try {
        const { data, error } = await this.supabase.client.functions.invoke('leer-cedulas-lote', { body: { imagen } });
        if (error) {
          const d = await edgeErrorDetail(error);
          throw new ErrorLectura(d.message, d.code, !!d.code && CODIGOS_FATALES.has(d.code));
        }
        const r = data as { ok?: boolean; lectura?: LecturaCedula; confianza_min?: number; error?: string; error_code?: string } | null;
        if (!r?.ok || !r.lectura) {
          const code = r?.error_code;
          throw new ErrorLectura(r?.error || 'No se pudo leer la imagen.', code, !!code && CODIGOS_FATALES.has(code));
        }
        return { lectura: r.lectura, confianzaMin: typeof r.confianza_min === 'number' ? r.confianza_min : 0.85 };
      } catch (e) {
        ultimo = e instanceof ErrorLectura ? e : new ErrorLectura(e instanceof Error ? e.message : 'No se pudo leer la imagen.');
        if (ultimo.fatal || !(ultimo.codigo && CODIGOS_REINTENTABLES.has(ultimo.codigo))) break;
        await new Promise((r) => setTimeout(r, 1200));
      }
    }
    throw ultimo ?? new ErrorLectura('No se pudo leer la imagen.');
  }

  // ── Subida al expediente (solo tras confirmar el import) ─────────────────────
  /**
   * Sube cada foto a su persona con el flujo de siempre (bucket privado `personal-obra` +
   * `personal_obra_fotos`). NO pisa una foto del mismo tipo que la persona ya tenga (se reporta como omitida),
   * así «Deshacer» puede quitar exactamente lo subido sin perder nada previo.
   */
  async subirAlExpediente(items: ItemSubida[], onProgreso?: (hechos: number, total: number) => void): Promise<ResultadoSubida> {
    const existentes = new Map<string, Set<string>>();
    const resultado: ResultadoSubida = { subidas: [], omitidas: [], fallidas: [] };
    const res = await procesarConConcurrencia(items, 3, async (it) => {
      let tipos = existentes.get(it.personal.id);
      if (!tipos) {
        tipos = new Set((await this.personalSvc.getFotos(it.personal.id)).map((f) => f.tipo));
        existentes.set(it.personal.id, tipos);
      }
      if (tipos.has(it.tipo)) return { omitida: 'Ya tenía una foto de ese tipo' } as const;
      tipos.add(it.tipo); // reserva: dos fotos al mismo cupo no se pisan entre sí
      const path = await this.personalSvc.subirFoto(it.personal, it.tipo, it.file);
      return { path } as const;
    }, { onProgreso });
    res.forEach((r, i) => {
      const it = items[i];
      if ('ok' in r) {
        if (r.ok.path !== undefined) resultado.subidas.push({ fotoId: it.fotoId, personalId: it.personal.id, tipo: it.tipo, path: r.ok.path });
        else resultado.omitidas.push({ fotoId: it.fotoId, motivo: r.ok.omitida ?? '' });
      } else if ('error' in r) {
        resultado.fallidas.push({ fotoId: it.fotoId, msg: r.error instanceof Error ? r.error.message : 'No se pudo subir' });
      }
    });
    return resultado;
  }

  /** «Deshacer lote»: quita del bucket y de `personal_obra_fotos` las fotos que SUBIÓ este import. */
  async quitarSubidas(subidas: FotoSubida[]): Promise<void> {
    if (!subidas.length) return;
    const client = this.supabase.client;
    const { error } = await client.storage.from(BUCKET).remove(subidas.map((s) => s.path));
    if (error) throw new Error(error.message);
    for (const s of subidas) {
      await client.from('personal_obra_fotos').delete().eq('personal_id', s.personalId).eq('tipo', s.tipo).eq('foto_path', s.path);
    }
  }
}
