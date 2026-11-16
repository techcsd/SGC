import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';

/** DS-06 — cuenta analítica de Odoo vinculada a un proyecto (tabla hija). */
export interface CuentaAnaliticaFila {
  id: string;
  proyecto_id: string;
  odoo_analytic_id: number;
  rol: 'principal' | 'adicional';
  confirmado: boolean;
  confirmado_en: string | null;
  evidencia: Record<string, unknown>;
  proyectos: { codigo: string; nombre: string } | null;
}

/** DS-05 — bodega con su código de almacén de Odoo. */
export interface BodegaOdooFila {
  id: string;
  nombre: string;
  activo: boolean;
  codigo_odoo: string | null;
  odoo_warehouse_id: number | null;
}

/** DS-07 — propuesta de vínculo artículo SGC ↔ producto Odoo, pendiente de aprobación. */
export interface PropuestaCatalogoFila {
  id: string;
  odoo_product_id: number;
  nombre_odoo: string;
  categoria_odoo: string | null;
  uom_odoo: string | null;
  metodo: 'codigo' | 'nombre' | 'similitud';
  score: number;
  estado: 'propuesta' | 'aprobada' | 'rechazada';
  articulos: { codigo: string | null; nombre: string } | null;
}

/**
 * Homologación SGC ↔ Odoo (almacenes y cuentas analíticas). La confirmación pasa por el RPC
 * `odoo_analitica_confirmar` (solo admin; deja quién y cuándo). TODO: catálogo de productos (DS-07).
 */
@Injectable({ providedIn: 'root' })
export class OdooHomologacionService {
  private supabase = inject(SupabaseService);

  async cuentasAnaliticas(): Promise<CuentaAnaliticaFila[]> {
    const { data, error } = await this.supabase.client
      .from('proyecto_odoo_analiticas')
      .select('id, proyecto_id, odoo_analytic_id, rol, confirmado, confirmado_en, evidencia, proyectos(codigo, nombre)')
      .order('confirmado', { ascending: true })
      .order('odoo_analytic_id');
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as CuentaAnaliticaFila[];
  }

  async bodegas(): Promise<BodegaOdooFila[]> {
    const { data, error } = await this.supabase.client
      .from('bodegas')
      .select('id, nombre, activo, codigo_odoo, odoo_warehouse_id')
      .eq('es_prueba', false)
      .order('nombre');
    if (error) throw new Error(error.message);
    return (data ?? []) as BodegaOdooFila[];
  }

  async propuestasCatalogo(): Promise<PropuestaCatalogoFila[]> {
    const { data, error } = await this.supabase.client
      .from('odoo_homologacion_propuestas')
      .select('id, odoo_product_id, nombre_odoo, categoria_odoo, uom_odoo, metodo, score, estado, articulos(codigo, nombre)')
      .eq('estado', 'propuesta')
      .order('score', { ascending: false })
      .limit(300);
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as PropuestaCatalogoFila[];
  }

  async decidirPropuesta(id: string, aprobar: boolean): Promise<void> {
    const { error } = await this.supabase.client.rpc('odoo_propuesta_decidir', { p_id: id, p_aprobar: aprobar });
    if (error) throw new Error(error.message);
  }

  async confirmarCuenta(id: string, confirmar: boolean): Promise<void> {
    const { error } = await this.supabase.client.rpc('odoo_analitica_confirmar', { p_id: id, p_confirmar: confirmar });
    if (error) throw new Error(error.message);
  }
}
