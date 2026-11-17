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

/** DS-27 — criterios de salida del canary (medidos en el outbox y el conciliador). */
export interface CriteriosCanary {
  muestras: number;
  p99_publicacion_s: number;
  fuera_de_canal_abiertas: number;
  cumple_p99: boolean;
  cumple_fuera_de_canal: boolean;
  ratificaciones: number[];
}

/** Conciliador SGC ↔ Odoo (solo lectura para Tecnología). La corrida la hace la edge `odoo-conciliar` (cron). */
@Injectable({ providedIn: 'root' })
export class OdooConciliacionService {
  private supabase = inject(SupabaseService);

  async estado(): Promise<EstadoConciliacion> {
    const { data, error } = await this.supabase.client.rpc('odoo_conciliacion_estado');
    if (error) throw new Error(error.message);
    return data as EstadoConciliacion;
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
