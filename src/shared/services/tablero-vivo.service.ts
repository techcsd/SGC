import { Injectable, inject } from '@angular/core';
import { RealtimeChannel } from '@supabase/supabase-js';
import { SupabaseService } from '../../app/core/services/supabase.service';

// ── DB1 — «Hoy, en vivo» (Inicio). Una sola RPC trae KPIs del día, el flujo de
// pedidos por etapa, los últimos eventos y la flota; Supabase Realtime avisa
// cuando algo cambia y el cliente RE-PIDE el resumen (debounce en el consumidor
// — nada se calcula en el navegador). Si Realtime no conecta, el consumidor cae
// a polling de 30 s.

export interface TableroVivo {
  kpis: {
    requisiciones_hoy: number;
    conduces_hoy: number;
    entregas_hoy: number;
    echadas_hoy: number;
    /** DG3 — solo usos abiertos en las últimas 24h (ventana rodante, no "fin_at is null" a secas). */
    vehiculos_en_uso: number;
    /** DG3 — usos abiertos hace MÁS de 24h: probable olvido de cerrar, no uso real de hoy. */
    usos_sin_cerrar: number;
    bitacoras_hoy: number;
  };
  flujo: {
    solicitada: number;
    aprobada: number;
    despachada: number;
    /** DG3 — ventana rodante de 48h (antes contaba conduces en tránsito de hace semanas). */
    en_ruta: number;
    /** DG3 — en tránsito hace MÁS de 48h sin entregar: conduces atascados, aparte de "en_ruta". */
    atrasados: number;
    entregada: number;
  };
  eventos: { tipo: string; titulo: string; detalle: string; at: string }[];
  flota: {
    vehiculo_id: string;
    placa: string | null;
    alias: string | null;
    chofer: string | null;
    lat: number;
    lng: number;
    capturado_en: string;
    /** DG3 — minutos desde capturado_en hasta ahora, calculado en el servidor. */
    edad_min: number;
    /** F6b (DF4-C) — solo si el vehículo tiene una ruta en curso con destino real. */
    destino_lat: number | null;
    destino_lng: number | null;
    destino_texto: string | null;
    /** Derivada del km_estimado/tiempo_estimado_min de la propia ruta — nunca inventada. */
    velocidad_estim_kmh: number | null;
  }[];
  generado_en: string;
}

/** DG3 — detalle abrible (AT11) de "atrasados" y "usos sin cerrar". */
export interface ConduceAtrasado {
  referencia: string;
  obra: string;
  vehiculo: string;
  horas_en_transito: number;
  transito_at: string;
}

export interface UsoSinCerrar {
  vehiculo_id: string;
  vehiculo: string;
  chofer: string;
  horas_abierto: number;
  inicio_at: string;
}

/** Tablas cuyo cambio re-pide el resumen (mismas de la publicación, db14). */
const TABLAS_VIVO = [
  'solicitudes_material', 'salidas_inventario', 'vehiculo_usos',
  'registros_combustible', 'bitacoras', 'chofer_ultima_posicion',
] as const;

@Injectable({ providedIn: 'root' })
export class TableroVivoService {
  private supabase = inject(SupabaseService);
  private channel: RealtimeChannel | null = null;

  async resumen(): Promise<TableroVivo> {
    const { data, error } = await this.supabase.client.rpc('tablero_vivo_resumen');
    if (error) throw new Error(error.message);
    return data as unknown as TableroVivo;
  }

  /** DG3 — detalle de los conduces atrasados (en tránsito hace más de 48h). */
  async atrasadosDetalle(): Promise<ConduceAtrasado[]> {
    const { data, error } = await this.supabase.client.rpc('conduces_atrasados_detalle');
    if (error) throw new Error(error.message);
    return (data ?? []) as ConduceAtrasado[];
  }

  /** DG3 — detalle de los usos de vehículo abiertos hace más de 24h. */
  async usosSinCerrarDetalle(): Promise<UsoSinCerrar[]> {
    const { data, error } = await this.supabase.client.rpc('usos_sin_cerrar_detalle');
    if (error) throw new Error(error.message);
    return (data ?? []) as UsoSinCerrar[];
  }

  /** Se suscribe a los cambios de las tablas del tablero. `onCambio` se dispara
   *  por CADA evento (el consumidor hace el debounce); `onEstado` reporta si
   *  Realtime quedó conectado (false → el consumidor activa polling). */
  suscribir(onCambio: () => void, onEstado: (conectado: boolean) => void): void {
    if (this.channel) return;
    let ch = this.supabase.client.channel('tablero-vivo');
    for (const tabla of TABLAS_VIVO) {
      ch = ch.on('postgres_changes', { event: '*', schema: 'sgc', table: tabla }, () => onCambio());
    }
    this.channel = ch.subscribe((status) => onEstado(status === 'SUBSCRIBED'));
  }

  async desuscribir(): Promise<void> {
    if (!this.channel) return;
    const ch = this.channel;
    this.channel = null;
    try { await this.supabase.client.removeChannel(ch); } catch { /* ya cerrado */ }
  }
}
