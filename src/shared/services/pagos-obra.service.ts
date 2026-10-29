import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';
import { SignedUrlCache } from './signed-url-cache.service';

// ── DB4 — Pagos semanales con descargo firmado (submódulo ingenieria.pagos) ──
// Montos = dato sensible: RLS con gates propios (puede_ver/operar_pagos, db15),
// escrituras solo por RPC, y NADA de esto pasa por Compa/el conector (guard).

export interface PagoObra {
  id: string;
  proyecto_id: string;
  semana_desde: string;
  semana_hasta: string;
  estado: 'borrador' | 'enviado';
  complemento_de: string | null;
  enviado_at: string | null;
  pdf_path: string | null;
  correos_enviados: string[] | null;
  created_at: string;
  proyecto?: { nombre: string } | null;
}

export interface PagoObraLinea {
  id: string;
  pago_id: string;
  personal_id: string;
  nombre_snapshot: string;
  documento_tipo_snapshot: string | null;
  documento_numero_snapshot: string | null;
  cargo_snapshot: string | null;
  monto: number | null;
  concepto: string | null;
  firma_path: string | null;
  firmado_at: string | null;
  estado: 'pendiente' | 'firmado' | 'ausente';
}

const BUCKET = 'obra';

@Injectable({ providedIn: 'root' })
export class PagosObraService {
  private supabase = inject(SupabaseService);
  private signed = inject(SignedUrlCache);

  async listar(proyectoId: string): Promise<PagoObra[]> {
    const { data, error } = await this.supabase.client
      .from('pagos_obra')
      .select('*, proyecto:proyectos!proyecto_id(nombre)')
      .eq('proyecto_id', proyectoId)
      .order('semana_desde', { ascending: false })
      .limit(40);
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as PagoObra[];
  }

  async lineas(pagoId: string): Promise<PagoObraLinea[]> {
    const { data, error } = await this.supabase.client
      .from('pagos_obra_lineas')
      .select('*')
      .eq('pago_id', pagoId)
      .order('nombre_snapshot');
    if (error) throw new Error(error.message);
    return (data ?? []) as PagoObraLinea[];
  }

  async crear(proyectoId: string, desde: string, hasta: string): Promise<string> {
    const { data, error } = await this.supabase.client.rpc('pagos_obra_crear', {
      p_proyecto_id: proyectoId, p_desde: desde, p_hasta: hasta,
    });
    if (error) throw new Error(error.message);
    return data as string;
  }

  async guardarLinea(lineaId: string, cambios: { monto?: number | null; concepto?: string | null; firmaPath?: string | null; ausente?: boolean | null }): Promise<void> {
    const { error } = await this.supabase.client.rpc('pagos_obra_linea_guardar', {
      p_linea_id: lineaId,
      p_monto: cambios.monto ?? null,
      p_concepto: cambios.concepto ?? null,
      p_firma_path: cambios.firmaPath ?? null,
      p_firmado_en: 'web',
      p_ausente: cambios.ausente ?? null,
    });
    if (error) throw new Error(error.message);
  }

  /** Sube la firma del descargo (pad) al bucket `obra` y devuelve el path. */
  async subirFirma(pagoId: string, lineaId: string, blob: Blob): Promise<string> {
    const path = `pagos/${pagoId}/firmas/${lineaId}.png`;
    const { error } = await this.supabase.client.storage.from(BUCKET)
      .upload(path, blob, { contentType: 'image/png', upsert: true });
    if (error) throw new Error(error.message);
    return path;
  }

  async enviar(pagoId: string): Promise<void> {
    const { error } = await this.supabase.client.rpc('pagos_obra_enviar', { p_pago_id: pagoId });
    if (error) throw new Error(error.message);
  }

  async complemento(pagoId: string): Promise<string> {
    const { data, error } = await this.supabase.client.rpc('pagos_obra_complemento', { p_pago_id: pagoId });
    if (error) throw new Error(error.message);
    return data as string;
  }

  async reabrir(pagoId: string): Promise<void> {
    const { error } = await this.supabase.client.rpc('pagos_obra_reabrir', { p_pago_id: pagoId });
    if (error) throw new Error(error.message);
  }

  async pdfUrl(path: string): Promise<string> {
    return this.signed.signed(BUCKET, path);
  }

  /** Correos que recibirán el reporte (para el panel «Al enviar»). */
  async correosDestino(): Promise<string[]> {
    const { data } = await this.supabase.client
      .from('parametros').select('clave, valor')
      .in('clave', ['pagos_descargo_correos', 'pagos_descargo_correos_extra']);
    const todos = (data ?? []).flatMap((p: { valor: string }) => (p.valor ?? '').split(','));
    return [...new Set(todos.map((s) => s.trim().toLowerCase()).filter((s) => s.includes('@')))];
  }
}
