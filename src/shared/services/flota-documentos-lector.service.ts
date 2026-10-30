import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';

// ── DB3 — lector de documentos de flota (seguro / matrícula / marbete DGII) ──
// La edge `leer-documento-flota` lee el PDF/fotos por página; las RPC db8
// emparejan con vehículos y aplican con reglas de no-pisar-vigencias.
//
// Hotfix (30-oct-2026): `leer()` ya NO llama la edge directamente desde el
// navegador. Un PDF largo (24 páginas) tarda 8-13s incluso leído en paralelo
// por tandas — sostener esa conexión desde el navegador rozaba el límite del
// relay de Supabase ("No se pudo contactar el servicio", reporte real de
// Xaviel con MARBETES.pdf). Ahora el RPC `flota_documento_lectura_crear`
// dispara la lectura en segundo plano (pg_net) y el navegador hace POLLING de
// una fila — nunca sostiene una llamada larga.

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

  /** Lee un PDF (multipágina) o hasta 20 fotos con la edge de IA. Crea el
   *  trabajo (rápido) y espera el resultado por polling — nunca sostiene una
   *  llamada larga contra la edge (ver nota de hotfix arriba). */
  async leer(archivos: { data: string; mime: string }[]): Promise<{ paginas: PaginaLeida[]; omitidas: number }> {
    const { data: jobId, error } = await this.supabase.client.rpc('flota_documento_lectura_crear', {
      p_archivos: archivos as unknown as Record<string, unknown>[],
    });
    if (error) throw new Error(error.message);
    return this.esperarLectura(jobId as string);
  }

  private async esperarLectura(jobId: string, maxEsperaMs = 120_000): Promise<{ paginas: PaginaLeida[]; omitidas: number }> {
    const inicio = Date.now();
    while (Date.now() - inicio < maxEsperaMs) {
      const { data, error } = await this.supabase.client
        .from('flota_documentos_lecturas')
        .select('estado, resultado')
        .eq('id', jobId)
        .single();
      if (error) throw new Error(error.message);
      const fila = data as { estado: 'procesando' | 'listo' | 'error'; resultado: Record<string, unknown> | null };
      if (fila.estado === 'listo') {
        const r = fila.resultado as { paginas?: PaginaLeida[]; omitidas?: number };
        if (!r?.paginas) throw new Error('No se pudo interpretar el documento. Llena los campos a mano.');
        return { paginas: r.paginas, omitidas: r.omitidas ?? 0 };
      }
      if (fila.estado === 'error') {
        throw new Error((fila.resultado as { error?: string } | null)?.error || 'No se pudo leer el documento.');
      }
      await new Promise((res) => setTimeout(res, 1200));
    }
    throw new Error('La lectura está tardando más de lo normal. Inténtalo de nuevo en unos minutos.');
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
