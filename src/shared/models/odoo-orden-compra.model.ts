import { OrdenCompra, OrdenCompraItem } from './orden-compra.model';
import { OdooId, OdooOcVivo, OdooProductoCompra } from './odoo.model';

/** Renglón de OC con la identidad Odoo del producto (instantánea para mostrarla sin Odoo, D1). */
export interface OdooOrdenCompraItem extends OrdenCompraItem {
  odoo_product_id?: OdooId | null;
  odoo_uom_id?: OdooId | null;
  odoo_snapshot?: OdooProductoCompra | null;
}

/**
 * OC del camino Odoo: la misma OC de SGC más su vínculo con Odoo. El estado, número, total y
 * recepción NO se guardan en SGC: `odoo_vivo` se lee de Odoo cada vez que se carga la OC.
 */
export interface OdooOrdenCompra extends Omit<OrdenCompra, 'items'> {
  items?: OdooOrdenCompraItem[];
  odoo_id?: OdooId | null;
  /** Lectura en vivo de Odoo; null si la OC aún no está en Odoo o si la consulta falló. */
  odoo_vivo?: OdooOcVivo | null;
  /** 'error' = no se pudo consultar Odoo (no se muestran datos viejos disfrazados de frescos). */
  odoo_consulta?: 'ok' | 'error';
}

const ESTADO_ODOO_LABEL: Record<string, string> = {
  draft: 'Borrador en Odoo',
  sent: 'Borrador en Odoo',
  'to approve': 'Pendiente de aprobación en Odoo',
  purchase: 'Confirmada en Odoo',
  done: 'Cerrada en Odoo',
  cancel: 'Cancelada en Odoo',
};

/** Texto del estado de Odoo para una OC (lo que ve el usuario). */
export function estadoOdooLabel(o: Pick<OdooOrdenCompra, 'odoo_id' | 'odoo_vivo' | 'odoo_consulta'>): string {
  if (!o.odoo_id) return 'Solo SGC';
  if (o.odoo_consulta === 'error') return 'No se pudo consultar Odoo';
  const e = o.odoo_vivo?.estado;
  return (e && ESTADO_ODOO_LABEL[e]) || 'Estado de Odoo no disponible';
}
