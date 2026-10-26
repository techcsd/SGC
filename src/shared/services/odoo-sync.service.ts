import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';
import { OdooEventoDetalle, OdooEventoEstado, OdooEventoFila, OdooAgregadoTipo, OdooEventosResumenFila } from '../models/odoo-sync.model';

/**
 * CY16 (#16) — bandeja de sincronización con Odoo (Tecnología). Solo lectura
 * + reintento autorizado; el reintento re-encola para el MISMO procesador
 * (odoo-sync), nunca edita un resultado a mano.
 */
@Injectable({ providedIn: 'root' })
export class OdooSyncService {
  private supabase = inject(SupabaseService);

  async listar(agregadoTipo: OdooAgregadoTipo | null, estado: OdooEventoEstado | null): Promise<OdooEventoFila[]> {
    const { data, error } = await this.supabase.client.rpc('odoo_eventos_listar', {
      p_agregado_tipo: agregadoTipo,
      p_estado: estado,
      p_limite: 500,
    });
    if (error) throw new Error(error.message);
    return (data ?? []) as OdooEventoFila[];
  }

  async resumen(): Promise<OdooEventosResumenFila[]> {
    const { data, error } = await this.supabase.client.rpc('odoo_eventos_resumen');
    if (error) throw new Error(error.message);
    return (data ?? []) as OdooEventosResumenFila[];
  }

  async detalle(eventoId: string): Promise<OdooEventoDetalle | null> {
    const { data, error } = await this.supabase.client.rpc('odoo_evento_detalle', { p_evento_id: eventoId });
    if (error) throw new Error(error.message);
    return (data as OdooEventoDetalle | null) ?? null;
  }

  async reintentar(eventoId: string): Promise<void> {
    const { error } = await this.supabase.client.rpc('odoo_evento_reintentar', { p_evento_id: eventoId });
    if (error) throw new Error(error.message);
  }
}
