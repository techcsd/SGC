import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';

/** DS-17/DS-28 — faltante en tránsito de un conduce entregado incompleto (ADR 5). */
export interface AjusteFaltanteFila {
  id: string;
  salida_id: string;
  folio: string;
  articulo: string;
  faltante: number;
  estado: 'pendiente' | 'aprobada' | 'rechazada';
  accion: 'ajuste' | 'devolver_transito' | null;
  nota: string | null;
  creada_en: string;
  decidida_en: string | null;
  odoo_sync_estado: 'pendiente' | 'sincronizado' | 'incierto' | 'error' | null;
  odoo_sync_error: string | null;
  odoo_picking_id: number | null;
}

/** DS-29 — corte por bodega (apertura, fuente del stock, contingencia). */
export interface CorteBodegaFila {
  bodega_id: string;
  bodega: string;
  codigo_odoo: string | null;
  homologada: boolean;
  fecha_corte: string | null;
  apertura_hecha: boolean;
  apertura_en: string | null;
  apertura_error: string | null;
  fuente_odoo: boolean;
  contingencia_hasta: string | null;
}

export type TablaPruebaReal = 'salidas_inventario' | 'entradas_inventario' | 'retiros_material' | 'conduces_externos' | 'conteos_inventario';

/** Ajustes por faltante, corte por bodega y autorización prueba → real. Toda regla vive en el servidor (RPC con gate de rol). */
@Injectable({ providedIn: 'root' })
export class OdooAjustesService {
  private supabase = inject(SupabaseService);

  async listar(): Promise<AjusteFaltanteFila[]> {
    const { data, error } = await this.supabase.client.rpc('odoo_ajustes_listado');
    if (error) throw new Error(error.message);
    return (data ?? []) as AjusteFaltanteFila[];
  }

  async decidir(id: string, aprobar: boolean, nota: string | null): Promise<void> {
    const { error } = await this.supabase.client.rpc('odoo_ajuste_decidir', { p_id: id, p_aprobar: aprobar, p_nota: nota });
    if (error) throw new Error(error.message);
  }

  async corte(): Promise<CorteBodegaFila[]> {
    const { data, error } = await this.supabase.client.rpc('odoo_corte_listado');
    if (error) throw new Error(error.message);
    return (data ?? []) as CorteBodegaFila[];
  }

  async configurarCorte(bodegaId: string, fecha: string): Promise<void> {
    const { error } = await this.supabase.client.rpc('odoo_corte_configurar', { p_bodega: bodegaId, p_fecha: fecha, p_apertura_hecha: false });
    if (error) throw new Error(error.message);
  }

  async aprobarContingencia(bodegaId: string, motivo: string, horas: number): Promise<void> {
    const { error } = await this.supabase.client.rpc('odoo_contingencia_aprobar', { p_bodega: bodegaId, p_motivo: motivo, p_horas: horas });
    if (error) throw new Error(error.message);
  }

  async autorizarPruebaReal(tabla: TablaPruebaReal, id: string, motivo: string): Promise<void> {
    const { error } = await this.supabase.client.rpc('odoo_prueba_real_autorizar', { p_tabla: tabla, p_id: id, p_motivo: motivo, p_horas: 2 });
    if (error) throw new Error(error.message);
  }
}
