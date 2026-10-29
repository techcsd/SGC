import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';
import { invokeEdge } from '../utils/edge.util';

// ── DB3 — lector de documentos de flota (seguro / matrícula / marbete DGII) ──
// La edge `leer-documento-flota` lee el PDF/fotos por página; las RPC db8
// emparejan con vehículos y aplican con reglas de no-pisar-vigencias.

export type TipoDocumentoFlota = 'seguro' | 'matricula' | 'marbete_dgii' | 'licencia' | 'otro' | 'reverso';

export interface CamposDocumentoFlota {
  poliza?: string | null;
  aseguradora?: string | null;
  vigencia_desde?: string | null;
  vigencia_hasta?: string | null;
  placa?: string | null;
  chasis?: string | null;
  marca?: string | null;
  modelo?: string | null;
  anio?: number | null;
  numero_matricula?: string | null;
  marbete_numero?: string | null;
}

export interface PaginaLeida {
  pagina: number;
  tipo: TipoDocumentoFlota;
  campos: CamposDocumentoFlota;
  confianza: Record<string, number>;
}

export type MatchDocumento = 'exacta' | 'vin' | 'revisar' | 'sin_vehiculo';

export interface PaginaEmparejada extends PaginaLeida {
  match: MatchDocumento;
  vehiculo_id?: string | null;
  vehiculo_placa?: string | null;
  vehiculo_alias?: string | null;
  candidatos?: { vehiculo_id: string; placa: string; alias: string | null }[];
}

export interface FilaAplicar {
  vehiculo_id: string;
  tipo: 'seguro' | 'matricula' | 'marbete_dgii';
  campos: CamposDocumentoFlota;
  imagen_path?: string | null;
  pagina?: number;
}

export interface ResultadoAplicar {
  vehiculo_id: string | null;
  pagina: number | null;
  ok: boolean;
  aplicado: Record<string, unknown>;
  omitido: string | null;
  error: string | null;
}

const BUCKET = 'flota-documentos';

@Injectable({ providedIn: 'root' })
export class FlotaDocumentosLectorService {
  private supabase = inject(SupabaseService);

  /** Lee un PDF (multipágina) o hasta 20 fotos con la edge de IA. */
  async leer(archivos: { data: string; mime: string }[]): Promise<{ paginas: PaginaLeida[]; omitidas: number }> {
    const res = await invokeEdge<{ ok: boolean; paginas?: PaginaLeida[]; omitidas?: number; error?: string }>(
      this.supabase.client, 'leer-documento-flota', { archivos },
    );
    if (!res.ok || !res.paginas) throw new Error(res.error || 'No se pudo leer el documento.');
    return { paginas: res.paginas, omitidas: res.omitidas ?? 0 };
  }

  /** Empareja las páginas leídas con la flota (placa exacta → VIN → distancia 1). */
  async emparejar(paginas: PaginaLeida[]): Promise<PaginaEmparejada[]> {
    const { data, error } = await this.supabase.client.rpc('flota_documentos_emparejar', {
      p_paginas: paginas as unknown as Record<string, unknown>[],
    });
    if (error) throw new Error(error.message);
    return (data ?? []) as PaginaEmparejada[];
  }

  /** Sube la imagen de una página al bucket de documentos de flota. */
  async subirImagenPagina(vehiculoId: string, tipo: string, blob: Blob): Promise<string> {
    const slot = tipo === 'marbete_dgii' ? 'marbete' : tipo;
    const path = `vehiculo/${vehiculoId}/${slot}/${crypto.randomUUID()}-lector.png`;
    const { error } = await this.supabase.client.storage.from(BUCKET).upload(path, blob, { contentType: 'image/png' });
    if (error) throw new Error(error.message);
    return path;
  }

  /** Aplica las filas confirmadas (transaccional por fila en el servidor). */
  async aplicar(filas: FilaAplicar[]): Promise<ResultadoAplicar[]> {
    const { data, error } = await this.supabase.client.rpc('flota_documentos_aplicar', {
      p_filas: filas as unknown as Record<string, unknown>[],
    });
    if (error) throw new Error(error.message);
    return (data ?? []) as ResultadoAplicar[];
  }
}
