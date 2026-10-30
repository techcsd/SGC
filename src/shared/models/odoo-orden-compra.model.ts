import { OrdenCompra, OrdenCompraItem } from './orden-compra.model';
import { OdooId, OdooProductoCompra } from './odoo.model';

/** CY24 (#24, D3/D4) — semáforo de SGC sobre el ciclo de publicación (check real de la BD; NULL = nunca publicada). */
export type OdooSyncEstado = 'pendiente' | 'publicada' | 'confirmada' | 'cancelada' | 'error' | 'incierto' | 'conflicto';

/** Renglón de OC con la identidad Odoo del producto (instantánea para mostrarla sin Odoo, D1). */
export interface OdooOrdenCompraItem extends OrdenCompraItem {
  odoo_product_id?: OdooId | null;
  odoo_uom_id?: OdooId | null;
  odoo_snapshot?: OdooProductoCompra | null;
}

/** OC del camino Odoo: la misma OC de SGC más el estado de su publicación en Odoo. */
export interface OdooOrdenCompra extends Omit<OrdenCompra, 'items'> {
  items?: OdooOrdenCompraItem[];
  odoo_sync_estado: OdooSyncEstado | null;
  odoo_state: string | null;
  odoo_nombre: string | null;
  odoo_total: number | null;
  odoo_sync_error: string | null;
  odoo_id?: OdooId | null;
}
