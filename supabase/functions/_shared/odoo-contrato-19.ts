// _shared/odoo-contrato-19.ts -- EB-01/EB22: campos que SGC ESCRIBE en Odoo 19.0+e, verificados con fields_get
// (28-nov-2026). Los simuladores los usan para rechazar un campo que Odoo 19 no tiene, igual que Odoo real
// ("ValueError: Invalid field ..."), y el test de contrato (odoo-contrato.test.ts, ODOO_CONTRACT_TEST=1) los
// compara contra fields_get del Odoo real (solo lectura).
export const CAMPOS_ESCRITOS_19: Record<string, string[]> = {
  "stock.picking": ["picking_type_id", "location_id", "location_dest_id", "company_id", "origin", "note", "move_ids", "partner_id"],
  "stock.move": ["description_picking", "product_id", "product_uom_qty", "product_uom", "location_id", "location_dest_id", "company_id", "quantity"],
  "purchase.order": ["partner_id", "company_id", "date_order", "picking_type_id", "note", "order_line", "origin", "partner_ref"],
  "purchase.order.line": ["product_id", "name", "product_qty", "price_unit", "product_uom_id", "analytic_distribution", "date_planned"],
  "product.product": ["name", "type", "is_storable", "purchase_ok", "sale_ok", "default_code", "categ_id", "uom_id"],
  "stock.quant": ["product_id", "location_id", "inventory_quantity"],
};

/** Lanza como Odoo real si `vals` trae un campo que Odoo 19 no tiene (solo valida los modelos del mapa). */
export function validarCamposOdoo19(model: string, vals: Record<string, unknown>): void {
  const ok = CAMPOS_ESCRITOS_19[model];
  if (!ok) return;
  for (const k of Object.keys(vals)) {
    if (!ok.includes(k)) throw new Error(`ValueError: Invalid field '${k}' in '${model}'`);
  }
}
