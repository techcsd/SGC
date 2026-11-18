import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';

/** DS-24 — solicitud pendiente que superó el plazo sin respuesta. */
export interface SolicitudVencida {
  tipo: 'compra' | 'material';
  id: string;
  folio: string;
  descripcion: string;
  proyecto: string | null;
  solicitante: string | null;
  creada_en: string;
  dias: number;
}

/** DS-24 — métrica «entradas con OC» (adopción). */
export interface EntradasConOc {
  total: number;
  con_oc: number;
  pct: number;
}

/** Panel de solicitudes vencidas con cierre masivo (motivo obligatorio, lo exige también el RPC). */
@Injectable({ providedIn: 'root' })
export class SolicitudesVencidasService {
  private supabase = inject(SupabaseService);

  async listar(): Promise<SolicitudVencida[]> {
    const { data, error } = await this.supabase.client.rpc('solicitudes_vencidas_listar');
    if (error) throw new Error(error.message);
    return (data ?? []) as SolicitudVencida[];
  }

  async cerrar(items: Array<{ tipo: string; id: string }>, motivo: string): Promise<number> {
    const { data, error } = await this.supabase.client.rpc('solicitudes_vencidas_cerrar', { p_items: items, p_motivo: motivo });
    if (error) throw new Error(error.message);
    return Number(data ?? 0);
  }

  async entradasConOc(): Promise<EntradasConOc> {
    const { data, error } = await this.supabase.client.rpc('adopcion_entradas_con_oc');
    if (error) throw new Error(error.message);
    const f = ((data ?? []) as EntradasConOc[])[0];
    return f ? { total: Number(f.total), con_oc: Number(f.con_oc), pct: Number(f.pct) } : { total: 0, con_oc: 0, pct: 0 };
  }
}
