import { Injectable, inject } from '@angular/core';
import * as mammoth from 'mammoth';
import { SupabaseService } from '../../app/core/services/supabase.service';
import {
  CampoPlantilla,
  DocumentoGenerado,
  PlantillaCategoria,
  PlantillaDocumento,
} from '../models/plantilla-documento.model';

const TOKEN_RE = /\{\{\s*([\w.]+)\s*\}\}/g;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function humanizeKey(key: string): string {
  return key
    .replace(/[_.]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
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

  /** Substitutes {{token}} placeholders with (HTML-escaped) form values. */
  renderizar(contenidoHtml: string, valores: Record<string, string>): string {
    return contenidoHtml.replace(TOKEN_RE, (_, key) => escapeHtml(valores[key] ?? ''));
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
