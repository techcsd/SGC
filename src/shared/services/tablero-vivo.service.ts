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
    vehiculos_en_uso: number;
    bitacoras_hoy: number;
  };
  flujo: {
    solicitada: number;
    aprobada: number;
    despachada: number;
    en_ruta: number;
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
  }[];
  generado_en: string;
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
