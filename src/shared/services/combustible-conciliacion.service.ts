import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';

/** Fila normalizada del informe importado (Total Energies u otro), sea Excel/CSV o
 *  PDF. Definida aquí (sin dependencias de Angular) para que el parser de PDF
 *  (`parse-pdf-totalenergies.util`) y el componente compartan EXACTAMENTE la forma. */
export interface InformeRow {
  identificador: string; // placa/registro/titular
  fecha: string | null; // YYYY-MM-DD
  galones: number | null;
  monto: number | null;
  // Z23 — datos extra del reporte real (para dedupe, preview y persistencia).
  transaccion_num: string;
  titular: string;
  titular_es_persona: boolean;
  numero_tarjeta: string;
  numero_registro: string;
  producto: string;
  kilometraje: number | null;
  hora: string;
  estacion_codigo: string;
  estacion_ubicacion: string;
  ncf: string;
  trans_status: string;
  numero_factura: string;
  total_factura: number | null;
  fecha_factura: string | null;
  duplicada?: boolean; // Transacción_num ya importado
  invalida?: boolean; // sin datos mínimos
  // BB7 — por qué la fila es inválida/dudosa (visible en tooltip + columna).
  motivos?: string[];
  // BB7 — el usuario puede excluir conscientemente una fila del import.
  excluida?: boolean;
  // BJ2 — código de alerta de control de consumo (FR/H/J/X/Y/Z), fuera de política.
  alerta?: string;
}

/** Cabecera guardada de una conciliación (para historial/dashboard). */
export interface ConciliacionRegistro {
  id: string;
  estacion: string;
  fecha_desde: string | null;
  fecha_hasta: string | null;
  nombre_archivo: string | null;
  total_informe_filas: number;
  total_matches: number;
  total_solo_plataforma: number;
  total_solo_informe: number;
  total_diferencias: number;
  monto_plataforma: number;
  monto_informe: number;
  galones_plataforma: number;
  galones_informe: number;
  notas: string | null;
  created_at: string;
}

export interface ConciliacionMeta {
  estacion: string;
  fecha_desde: string | null;
  fecha_hasta: string | null;
  nombre_archivo: string | null;
  total_informe_filas: number;
  total_matches: number;
  total_solo_plataforma: number;
  total_solo_informe: number;
  total_diferencias: number;
  monto_plataforma: number;
  monto_informe: number;
  galones_plataforma: number;
  galones_informe: number;
  notas: string | null;
  pdf_path?: string | null; // BJ2 — factura PDF original ligada a la conciliación
}

/** BJ2 — mapeo aprendido de una tarjeta de combustible. */
export interface TarjetaMap {
  codigo_tarjeta: string;
  vehiculo_id: string | null;
  placa: string | null;
  titular_nombre: string | null;
  es_persona: boolean;
  usuario_id: string | null;
  notas: string | null;
}

export interface ConciliacionDetalle {
  tipo: 'match' | 'diferencia' | 'solo_plataforma' | 'solo_informe';
  registro_id: string | null;
  vehiculo_id: string | null;
  identificador: string | null;
  fecha: string | null;
  galones_plataforma: number | null;
  galones_informe: number | null;
  monto_plataforma: number | null;
  monto_informe: number | null;
  diferencia_galones: number | null;
  diferencia_monto: number | null;
}

/** T4 — conciliación de combustible: registros de la plataforma + persistencia. */
@Injectable({ providedIn: 'root' })
export class CombustibleConciliacionService {
  private supabase = inject(SupabaseService);

  /** Registros de combustible en el rango de fechas (para el matching). */
  async getRegistrosEnRango(desde: string | null, hasta: string | null) {
    let q = this.supabase.client
      .from('registros_combustible')
      .select('id, vehiculo_id, fecha, galones, monto, estacion, vehiculo:vehiculos(placa)')
      // AC11 — las echadas de depósito en obra (garrafón) son consumo interno:
      // no tienen contraparte en el reporte de la estación, no se concilian.
      .neq('origen', 'deposito_obra');
    if (desde) q = q.gte('fecha', desde);
    if (hasta) q = q.lte('fecha', hasta);
    const { data, error } = await q.order('fecha', { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as {
      id: string;
      vehiculo_id: string;
      fecha: string;
      galones: number | null;
      monto: number | null;
      estacion: string | null;
      vehiculo?: { placa: string } | null;
    }[];
  }

  async guardar(meta: ConciliacionMeta, detalles: ConciliacionDetalle[]): Promise<string> {
    const { data, error } = await this.supabase.client.rpc('guardar_conciliacion_combustible', {
      p_meta: meta,
      p_detalles: detalles,
    });
    if (error) throw new Error(error.message);
    return data as string;
  }

  async getHistorial(): Promise<ConciliacionRegistro[]> {
    const { data, error } = await this.supabase.client
      .from('conciliaciones_combustible')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as ConciliacionRegistro[];
  }

  /** Z23 — inserta transacciones del proveedor deduplicando por Transacción_num. */
  async importarTransacciones(transacciones: Record<string, unknown>[]): Promise<number> {
    const { data, error } = await this.supabase.client.rpc('importar_transacciones_combustible', {
      p_transacciones: transacciones,
    });
    if (error) throw new Error(error.message);
    return (data as number) ?? 0;
  }

  /** Z23 — cuáles de estos Transacción_num ya se importaron (para el preview). */
  async transaccionesExistentes(nums: string[]): Promise<string[]> {
    if (nums.length === 0) return [];
    const { data, error } = await this.supabase.client.rpc('transacciones_existentes', { p_nums: nums });
    if (error) return [];
    return (data as string[]) ?? [];
  }

  /** BJ2 — sube la factura PDF original al bucket privado y devuelve su path. */
  async subirPdf(file: File): Promise<string> {
    const path = `conciliacion/${crypto.randomUUID()}.pdf`;
    const { error } = await this.supabase.client.storage
      .from('sgc-combustible')
      .upload(path, file, { upsert: true, contentType: 'application/pdf' });
    if (error) throw new Error(error.message);
    return path;
  }

  /** BJ2 — mapa tarjeta→vehículo/persona (se aprende una vez). */
  async getTarjetaMap(): Promise<TarjetaMap[]> {
    const { data, error } = await this.supabase.client.rpc('combustible_tarjeta_map_listar');
    if (error) return [];
    return (data ?? []) as TarjetaMap[];
  }

  /** BJ2 — upsert del mapeo de una tarjeta. */
  async setTarjetaMap(p: {
    codigo: string;
    vehiculo_id?: string | null;
    titular?: string | null;
    es_persona?: boolean;
    usuario_id?: string | null;
    notas?: string | null;
  }): Promise<void> {
    const { error } = await this.supabase.client.rpc('combustible_tarjeta_map_set', {
      p_codigo: p.codigo,
      p_vehiculo_id: p.vehiculo_id ?? null,
      p_titular: p.titular ?? null,
      p_es_persona: p.es_persona ?? false,
      p_usuario_id: p.usuario_id ?? null,
      p_notas: p.notas ?? null,
    });
    if (error) throw new Error(error.message);
  }

  async getDetalle(conciliacionId: string): Promise<ConciliacionDetalle[]> {
    const { data, error } = await this.supabase.client
      .from('conciliacion_combustible_detalle')
      .select('*')
      .eq('conciliacion_id', conciliacionId);
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as ConciliacionDetalle[];
  }
}
