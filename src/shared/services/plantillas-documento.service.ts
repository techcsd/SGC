import { Injectable, inject } from '@angular/core';
import * as mammoth from 'mammoth';
import { SupabaseService } from '../../app/core/services/supabase.service';
import {
  CampoPlantilla,
  DocumentoGenerado,
  PlantillaCategoria,
  PlantillaDocumento,
  PlantillaVersion,
} from '../models/plantilla-documento.model';

const TOKEN_RE = /\{\{\s*([\w.]+)\s*\}\}/g;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function humanizeKey(key: string): string {
  return key
    .replace(/[_.]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

// Fecha larga es-DO desde un YYYY-MM-DD, ej. `16 de julio de 2026`. Construida
// desde partes locales (nunca new Date(dateOnly), que desplazaría un día en UTC-4).
function formatFechaLarga(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d || m < 1 || m > 12) return iso;
  return `${d} de ${MESES[m - 1]} de ${y}`;
}

// Número con separador de miles, preservando decimales. Deja intacto lo que no
// sea un número simple (ej. rangos o texto).
function formatNumero(raw: string): string {
  const s = raw.trim();
  if (!/^-?\d+(\.\d+)?$/.test(s)) return raw;
  const neg = s.startsWith('-');
  const [intp, decp] = s.replace('-', '').split('.');
  const grouped = intp.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${neg ? '-' : ''}${grouped}${decp ? '.' + decp : ''}`;
}

@Injectable({ providedIn: 'root' })
export class PlantillasDocumentoService {
  private supabase = inject(SupabaseService);

  async getAll(): Promise<PlantillaDocumento[]> {
    const { data, error } = await this.supabase.client
      .from('plantillas_documento')
      .select('*')
      .eq('activo', true)
      .order('created_at', { ascending: false });

    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as PlantillaDocumento[];
  }

  // ── CF7 — Word de Sonia: convertir conservando formato + detectar espacios ────
  /**
   * Convierte el .docx a HTML (conserva títulos/negritas/listas), reemplaza cada
   * `____` (y `( ____ )`) por un token numerado `{{__hueco_N__}}`, y devuelve los
   * huecos con su contexto para el asistente de espacios. También respeta los
   * `{{token}}` que el documento ya tuviera.
   */
  async analizarWord(file: File): Promise<{ html: string; huecos: { n: number; contexto: string }[] }> {
    if (!file.name.toLowerCase().endsWith('.docx')) {
      throw new Error('Solo se admiten archivos .docx (Word). Guarda el documento en ese formato.');
    }
    const buffer = await file.arrayBuffer();
    const result = await mammoth.convertToHtml({ arrayBuffer: buffer });
    let html = result.value;

    // Reemplaza secuencias de 3+ guiones bajos por un token numerado, en orden.
    const huecos: { n: number; contexto: string }[] = [];
    let n = 0;
    html = html.replace(/_{3,}/g, (_m, offset: number) => {
      // Contexto: ~60 chars de texto plano alrededor del hueco.
      const plano = html.replace(/<[^>]+>/g, ' ');
      const planoOffset = html.slice(0, offset).replace(/<[^>]+>/g, ' ').length;
      const ini = Math.max(0, planoOffset - 45);
      const ctx = plano.slice(ini, planoOffset + 45).replace(/\s+/g, ' ').trim();
      huecos.push({ n, contexto: '…' + ctx + '…' });
      return `{{__hueco_${n++}__}}`;
    });
    return { html, huecos };
  }

  /**
   * Crea la plantilla a partir del Word analizado: `mapeo` indica a qué variable
   * (o "a mano") va cada hueco. Reemplaza `{{__hueco_N__}}` por `{{clave}}`, guarda
   * el .docx original y arma `campos`/`variables`.
   */
  async crearPlantillaDesdeWord(payload: {
    nombre: string;
    categoria: PlantillaCategoria;
    html: string;
    file: File;
    mapeo: { n: number; key: string; label: string }[];
    creadoPor: string | null;
  }): Promise<PlantillaDocumento> {
    let html = payload.html;
    const campos: CampoPlantilla[] = [];
    const vistos = new Set<string>();
    for (const m of payload.mapeo) {
      const key = m.key || `campo_${m.n + 1}`;
      html = html.split(`{{__hueco_${m.n}__}}`).join(`{{${key}}}`);
      if (!vistos.has(key)) {
        vistos.add(key);
        campos.push({ key, label: m.label || humanizeKey(key), tipo: 'texto' });
      }
    }
    // Huecos sin mapear → campo_N a mano.
    html = html.replace(/\{\{__hueco_(\d+)__\}\}/g, (_m, idx: string) => {
      const key = `campo_${Number(idx) + 1}`;
      if (!vistos.has(key)) { vistos.add(key); campos.push({ key, label: `Campo ${Number(idx) + 1}`, tipo: 'texto' }); }
      return `{{${key}}}`;
    });

    // Guarda el .docx original (referencia + descarga).
    let docxPath: string | null = null;
    try {
      docxPath = `${crypto.randomUUID()}-${payload.file.name}`;
      const { error: upErr } = await this.supabase.client.storage.from('plantillas-docx').upload(docxPath, payload.file);
      if (upErr) docxPath = null;
    } catch { docxPath = null; }

    const { data, error } = await this.supabase.client
      .from('plantillas_documento')
      .insert({
        nombre: payload.nombre,
        categoria: payload.categoria,
        contenido_html: html,
        campos,
        variables: payload.mapeo.map((m) => ({ key: m.key, label: m.label })),
        docx_path: docxPath,
        origen: 'usuario',
        creado_por: payload.creadoPor,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data as unknown as PlantillaDocumento;
  }

  /** CF7 — marca una plantilla como la predeterminada de su categoría. */
  async marcarDefault(plantillaId: string): Promise<void> {
    const { error } = await this.supabase.client.rpc('set_plantilla_default', { p_plantilla: plantillaId });
    if (error) throw new Error(error.message);
  }

  /** CF7/CE7 — edita una plantilla, guardando antes una versión (snapshot) para poder restaurar. */
  async editarPlantilla(id: string, cambios: { nombre: string; categoria: PlantillaCategoria; contenido_html: string; campos: CampoPlantilla[] }, motivo?: string): Promise<PlantillaDocumento> {
    // 1) snapshot de la versión actual (auditoría + restaurar).
    await this.supabase.client.rpc('guardar_plantilla_version', { p_plantilla: id, p_motivo: motivo ?? 'Edición' });
    // 2) aplica los cambios.
    const { data, error } = await this.supabase.client
      .from('plantillas_documento')
      .update({ nombre: cambios.nombre, categoria: cambios.categoria, contenido_html: cambios.contenido_html, campos: cambios.campos })
      .eq('id', id)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data as unknown as PlantillaDocumento;
  }

  async listarVersiones(plantillaId: string): Promise<PlantillaVersion[]> {
    const { data, error } = await this.supabase.client.rpc('plantilla_versiones_listar', { p_plantilla: plantillaId });
    if (error) throw new Error(error.message);
    return (data ?? []) as PlantillaVersion[];
  }

  async restaurarVersion(plantillaId: string, version: number): Promise<void> {
    const { error } = await this.supabase.client.rpc('restaurar_plantilla_version', { p_plantilla: plantillaId, p_version: version });
    if (error) throw new Error(error.message);
  }

  /** Deriva los campos {{clave}} presentes en el HTML (para re-sincronizar al editar). */
  camposDesdeHtml(html: string): CampoPlantilla[] {
    const keys = new Set<string>();
    for (const m of html.matchAll(TOKEN_RE)) keys.add(m[1]);
    return [...keys].map((key) => ({ key, label: humanizeKey(key), tipo: 'texto' as const }));
  }

  /** Parses an uploaded .docx and auto-detects {{token}} placeholders as form fields. */
  async subirPlantillaPersonalizada(
    nombre: string,
    categoria: PlantillaCategoria,
    file: File,
    creadoPor: string | null,
  ): Promise<PlantillaDocumento> {
    if (!file.name.toLowerCase().endsWith('.docx')) {
      throw new Error('Solo se admiten archivos .docx (Word). Guarda el documento en ese formato e inclúyele los campos como {{nombre_campo}}.');
    }

    const buffer = await file.arrayBuffer();
    const result = await mammoth.convertToHtml({ arrayBuffer: buffer });
    const html = result.value;

    const keys = new Set<string>();
    for (const match of html.matchAll(TOKEN_RE)) keys.add(match[1]);
    if (keys.size === 0) {
      throw new Error('No se encontraron campos {{...}} en el documento. Agrega marcadores como {{cliente}} donde quieras un campo rellenable.');
    }

    const campos: CampoPlantilla[] = [...keys].map((key) => ({ key, label: humanizeKey(key), tipo: 'texto' }));

    const { data, error } = await this.supabase.client
      .from('plantillas_documento')
      .insert({
        nombre,
        categoria,
        contenido_html: html,
        campos,
        origen: 'usuario',
        creado_por: creadoPor,
      })
      .select()
      .single();

    if (error) throw new Error(error.message);
    return data as unknown as PlantillaDocumento;
  }

  /**
   * Substitutes {{token}} placeholders with (HTML-escaped) form values. When the
   * plantilla's campos are provided, fecha values render as human es-DO dates and
   * numero values get thousands separators instead of the raw input.
   */
  renderizar(contenidoHtml: string, valores: Record<string, string>, campos: CampoPlantilla[] = []): string {
    const tipoByKey = new Map(campos.map((c) => [c.key, c.tipo]));
    return contenidoHtml.replace(TOKEN_RE, (_, key) => {
      const raw = valores[key] ?? '';
      if (!raw) return '';
      const tipo = tipoByKey.get(key);
      let value = raw;
      if (tipo === 'fecha') value = formatFechaLarga(raw);
      else if (tipo === 'numero') value = formatNumero(raw);
      return escapeHtml(value);
    });
  }

  async generar(payload: {
    plantillaId: string;
    nombre: string;
    proyectoId: string | null;
    valores: Record<string, string>;
    contenidoHtmlFinal: string;
    generadoPor: string | null;
  }): Promise<DocumentoGenerado> {
    const { data, error } = await this.supabase.client
      .from('documentos_generados')
      .insert({
        plantilla_id: payload.plantillaId,
        proyecto_id: payload.proyectoId,
        nombre: payload.nombre,
        valores: payload.valores,
        contenido_html_final: payload.contenidoHtmlFinal,
        generado_por: payload.generadoPor,
      })
      .select('*, plantilla:plantillas_documento(nombre, categoria), proyecto:proyectos(nombre)')
      .single();

    if (error) throw new Error(error.message);
    return data as unknown as DocumentoGenerado;
  }

  async getGeneradoById(id: string): Promise<DocumentoGenerado> {
    const { data, error } = await this.supabase.client
      .from('documentos_generados')
      .select('*, plantilla:plantillas_documento(nombre, categoria), proyecto:proyectos(nombre)')
      .eq('id', id)
      .single();

    if (error) throw new Error(error.message);
    return data as unknown as DocumentoGenerado;
  }

  async getHistorial(): Promise<DocumentoGenerado[]> {
    const { data, error } = await this.supabase.client
      .from('documentos_generados')
      .select('*, plantilla:plantillas_documento(nombre, categoria), proyecto:proyectos(nombre)')
      .order('created_at', { ascending: false });

    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as DocumentoGenerado[];
  }

  async eliminarPlantilla(id: string): Promise<void> {
    const { error } = await this.supabase.client.from('plantillas_documento').update({ activo: false }).eq('id', id);
    if (error) throw new Error(error.message);
  }
}
