import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';

/** DS-13 — hallazgo del conciliador SGC ↔ Odoo. */
export interface DiscrepanciaOdoo {
  id: string;
  tipo: string;
  salida_id: string | null;
  salida_folio: string | null;
  picking_id: number | null;
  detalle: string;
  primera_vez: string;
  ultima_vez: string;
  resuelta_en: string | null;
}

export interface CorridaConciliacion {
  tipo: 'diaria' | 'sondeo' | 'transito';
  iniciada_en: string;
  terminada_en: string | null;
  resumen: Record<string, unknown>;
  error: string | null;
}

export interface EstadoConciliacion {
  instancia: boolean;
  discrepancias: DiscrepanciaOdoo[];
  corridas: CorridaConciliacion[];
  retraso_outbox_min: number;
  inciertos_abiertos: number;
}

/** #204 / DS-27 — criterios de observación del canary (SLO 99 % < 2 min, outbox y conciliador). */
export interface CriteriosCanary {
  muestras: number;
  p99_publicacion_s: number;
  pct_en_2min: number | null;
  cumple_slo: boolean;
  /** Alias de cumple_slo (ya no significa p99 < 5 s). */
  cumple_p99: boolean;
  /** EB-06: estado honesto del SLO (la cola atascada o pocas muestras ya no se muestran como «cumple»). */
  estado_slo?: 'cumple' | 'incumple' | 'cola_atascada' | 'pocas_muestras';
  muestras_min?: number;
  cola_pendientes?: number;
  cola_mas_vieja_min?: number;
  cola_sin_intentos?: number;
  fuera_de_canal_abiertas: number;
  cumple_fuera_de_canal: boolean;
  inciertos_abiertos: number;
  outbox_errores: number;
  ratificaciones: number[];
}

/** «Pendientes en Odoo»: lo que el tablero de Inventario de Odoo cuenta como por procesar / atrasado, cruzado con SGC. */
export interface PendienteAlmacen { almacen: string; tipo: 'recepcion' | 'entrega' | 'interno' | 'otro'; por_procesar: number; atrasados: number; conocidos_sgc: number }
export interface PendienteOdoo { picking_id: number; nombre: string; origin: string | null; tipo: string; estado: string; programada: string | null; almacen: string | null; conocido: boolean; oc_sgc: boolean; conduce_sgc: boolean }
export interface ResumenPendientes { actualizado_en: string | null; por_almacen: PendienteAlmacen[]; lista: PendienteOdoo[]; reglas: { activas: number; ultima: string | null } }

/** Conciliador SGC ↔ Odoo (solo lectura para Tecnología). La corrida la hace la edge `odoo-conciliar` (cron). */
@Injectable({ providedIn: 'root' })
export class OdooConciliacionService {
  private supabase = inject(SupabaseService);

  async estado(): Promise<EstadoConciliacion> {
    const { data, error } = await this.supabase.client.rpc('odoo_conciliacion_estado');
    if (error) throw new Error(error.message);
    return data as EstadoConciliacion;
  }

  async pendientes(): Promise<ResumenPendientes> {
    const { data, error } = await this.supabase.client.rpc('odoo_pendientes_resumen');
    if (error) throw new Error(error.message);
    return data as ResumenPendientes;
  }

  async criteriosCanary(): Promise<CriteriosCanary> {
    const { data, error } = await this.supabase.client.rpc('odoo_canary_criterios');
    if (error) throw new Error(error.message);
    return data as CriteriosCanary;
  }

  /** Corre el conciliador ahora (Tecnología). El JWT del usuario autoriza la edge, que usa la instancia habilitada. */
  async conciliarAhora(): Promise<void> {
    const { error } = await this.supabase.client.functions.invoke('odoo-conciliar', { body: { tarea: 'diaria' } });
    if (error) throw new Error(error.message);
  }
}
