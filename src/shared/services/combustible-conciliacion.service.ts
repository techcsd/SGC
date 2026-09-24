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

/** BX4 — factura de combustible guardada al subir (estado + diagnóstico). */
export interface CombustibleFactura {
  id: string;
  nro_factura: string | null;
  estacion: string | null;
  archivo_path: string;
  miniatura_path: string | null;
  tamano: number | null;
  paginas: number | null;
  fecha_documento: string | null;
  total_factura: number | null;
  estado: 'subida' | 'parseada' | 'importada' | 'fallida';
  diagnostico: { diagnostico?: string; rows?: number; cards?: number; cuadre?: { esperado: number | null; obtenido: number; cuadra: boolean }; columnas_faltantes?: string[] } | null;
  conciliacion_id: string | null;
  subido_por_nombre: string | null;
  subido_en: string;
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
  // BT1 — datos de la fila del informe (para «Registrar faltantes» — resolución por tarjeta).
  numero_tarjeta?: string | null;
  transaccion_num?: string | null;
  titular?: string | null;
  titular_es_persona?: boolean;
  kilometraje?: number | null;
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

  /** BV12 — reporta a Tecnología (report_app_error) una factura de TotalEnergies que
   *  no se pudo leer, con las primeras líneas extraídas (montos redactados) para que
   *  el formato nuevo se arregle sin pedirle el archivo a Raykler. No bloquea. */
  async reportarPdfNoLeido(diagnostico: string, muestra: string[], nombre: string): Promise<void> {
    try {
      await this.supabase.client.rpc('report_app_error', {
        p_error_type: 'sync',
        p_message: `Factura TotalEnergies no leída (${diagnostico}): ${nombre}`,
        p_stack: muestra.join('\n').slice(0, 4000),
        p_context: { origen: 'conciliacion-combustible', diagnostico, archivo: nombre },
        p_device_brand: 'web',
        p_device_model: 'Navegador',
        p_os_version: '',
        p_app_version: '',
        p_platform: 'web',
        p_source: 'web',
      });
    } catch {
      /* el reporte nunca bloquea la UI */
    }
  }

  async guardar(meta: ConciliacionMeta, detalles: ConciliacionDetalle[]): Promise<string> {
    const { data, error } = await this.supabase.client.rpc('guardar_conciliacion_combustible', {
      p_meta: meta,
      p_detalles: detalles,
    });
    if (error) throw new Error(error.message);
    return data as string;
  }

  /** BT1 — crea las echadas faltantes (filas del informe sin match) para una
   *  conciliación ya guardada. Idempotente por (conciliación, nro_factura). */
  async importarEchadas(
    conciliacionId: string,
    filas: Record<string, unknown>[],
  ): Promise<{ creadas: number; con_km_pendiente: number; sin_asignacion: number; errores: { i: number; motivo: string }[] }> {
    const { data, error } = await this.supabase.client.rpc('importar_echadas_conciliacion', {
      p_conciliacion_id: conciliacionId,
      p_filas: filas,
    });
    if (error) throw new Error(error.message);
    return data as { creadas: number; con_km_pendiente: number; sin_asignacion: number; errores: { i: number; motivo: string }[] };
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

  // ── BX4 — Guardar el PDF AL SUBIR (antes de parsear) + ficha de factura ──────
  /** BX4 — sha256 del archivo (dedupe cuando no se pudo leer el nº de factura). */
  async sha256(file: File): Promise<string> {
    const buf = await file.arrayBuffer();
    const hash = await crypto.subtle.digest('SHA-256', buf);
    return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  /** BX4 — sube el PDF a facturas/<año>/<clave>.pdf (upsert = idempotente por clave). */
  async subirFacturaPdf(file: File, anio: number, clave: string): Promise<string> {
    const path = `facturas/${anio}/${clave}.pdf`;
    const { error } = await this.supabase.client.storage
      .from('sgc-combustible')
      .upload(path, file, { upsert: true, contentType: 'application/pdf' });
    if (error) throw new Error(error.message);
    return path;
  }

  /** BX4 — sube la miniatura PNG de la página 1. */
  async subirMiniatura(blob: Blob, path: string): Promise<string> {
    const { error } = await this.supabase.client.storage
      .from('sgc-combustible')
      .upload(path, blob, { upsert: true, contentType: blob.type || 'image/png' });
    if (error) throw new Error(error.message);
    return path;
  }

  /** BX4 — registra la factura AL SUBIR (dedupe por nº o sha256). Devuelve id+existente. */
  async registrarFactura(p: {
    archivo_path: string; nro_factura?: string | null; estacion?: string | null;
    tamano?: number | null; paginas?: number | null; fecha_documento?: string | null;
    total_factura?: number | null; sha256?: string | null;
  }): Promise<{ id: string; existente: boolean; estado: string; subido_por?: string | null; subido_en?: string | null }> {
    const { data, error } = await this.supabase.client.rpc('combustible_factura_registrar', {
      p_archivo_path: p.archivo_path,
      p_nro_factura: p.nro_factura ?? null,
      p_estacion: p.estacion ?? null,
      p_tamano: p.tamano ?? null,
      p_paginas: p.paginas ?? null,
      p_fecha_documento: p.fecha_documento ?? null,
      p_total_factura: p.total_factura ?? null,
      p_sha256: p.sha256 ?? null,
    });
    if (error) throw new Error(error.message);
    return data as { id: string; existente: boolean; estado: string };
  }

  /** BX4 — actualiza estado/diagnóstico/miniatura tras parsear. */
  async actualizarFactura(id: string, p: {
    estado?: string; diagnostico?: unknown; miniatura_path?: string | null;
    nro_factura?: string | null; fecha_documento?: string | null; total_factura?: number | null; paginas?: number | null;
  }): Promise<void> {
    const { error } = await this.supabase.client.rpc('combustible_factura_actualizar', {
      p_id: id,
      p_estado: p.estado ?? null,
      p_diagnostico: p.diagnostico ?? null,
      p_miniatura_path: p.miniatura_path ?? null,
      p_nro_factura: p.nro_factura ?? null,
      p_fecha_documento: p.fecha_documento ?? null,
      p_total_factura: p.total_factura ?? null,
      p_paginas: p.paginas ?? null,
    });
    if (error) throw new Error(error.message);
  }

  /** BX4 — enlaza la factura a la conciliación guardada. */
  async vincularFactura(id: string, conciliacionId: string): Promise<void> {
    const { error } = await this.supabase.client.rpc('combustible_factura_vincular', {
      p_id: id, p_conciliacion_id: conciliacionId,
    });
    if (error) throw new Error(error.message);
  }

  /** BX4 — lista de facturas subidas (Flota › Conciliación › Facturas). */
  async listarFacturas(): Promise<CombustibleFactura[]> {
    const { data, error } = await this.supabase.client.rpc('combustible_facturas_listar');
    if (error) throw new Error(error.message);
    return (data ?? []) as CombustibleFactura[];
  }

  /** BX4 — URL firmada (1 h) para ver/bajar el PDF o la miniatura del bucket privado. */
  async urlFirmada(path: string, segundos = 3600): Promise<string | null> {
    if (!path) return null;
    const { data, error } = await this.supabase.client.storage
      .from('sgc-combustible').createSignedUrl(path, segundos);
    if (error) return null;
    return data?.signedUrl ?? null;
  }

  /** BJ2 — mapa tarjeta→vehículo/persona (se aprende una vez). */
  async getTarjetaMap(): Promise<TarjetaMap[]> {
    const { data, error } = await this.supabase.client.rpc('combustible_tarjeta_map_listar');
    if (error) return [];
    return (data ?? []) as TarjetaMap[];
  }

  /** BV13 — sugiere el vehículo probable de una tarjeta por su titular (mapa →
   *  titular≈vehículo único → persona→asignado). null si no hay candidato claro. */
  async sugerirVehiculoTarjeta(titular: string, fecha: string | null, placa?: string | null): Promise<{ vehiculo_id: string; score: number; via: string } | null> {
    const { data, error } = await this.supabase.client.rpc('sugerir_vehiculo_tarjeta', {
      p_titular: titular,
      p_fecha: fecha,
      p_placa: placa ?? null,
    });
    if (error || !Array.isArray(data) || !data.length) return null;
    const s = data[0] as { vehiculo_id: string; score: number; via: string };
    return s.vehiculo_id ? s : null;
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
