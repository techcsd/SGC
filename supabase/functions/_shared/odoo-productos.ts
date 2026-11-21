// Alta de product.product en Odoo (ADR 15). Solo se llama después de la
// aprobación de Contabilidad; el cliente jamás manda el payload a Odoo, solo
// el id de la solicitud. Idempotente por default_code o nombre exacto.
import type { OdooClient } from "./odoo-client.ts";
import { OdooError } from "./odoo-client.ts";

export interface ProductoNuevoVals {
  nombre: string;
  codigo?: string | null;
  categId?: number | null;
  uomId?: number | null;
}

export interface ProductoCreado {
  id: number;
  templateId: number | null;
  nombre: string;
  codigo: string | null;
  unidad: string | null;
  unidadId: number | null;
  categoria: string | null;
  categoriaId: number | null;
  yaExistia: boolean;
}

export type AdaptadorCrearProducto = (vals: ProductoNuevoVals) => Promise<ProductoCreado>;

const m2o = (v: unknown): { id: number; nombre: string } | null =>
  Array.isArray(v) && typeof v[0] === "number" ? { id: v[0], nombre: String(v[1] ?? "") } : null;

function desdeFila(f: Record<string, unknown>, yaExistia: boolean): ProductoCreado {
  const unidad = m2o(f.uom_id);
  const categoria = m2o(f.categ_id);
  const plantilla = typeof f.product_tmpl_id === "number" ? f.product_tmpl_id : m2o(f.product_tmpl_id)?.id ?? null;
  return {
    id: f.id as number,
    templateId: plantilla,
    nombre: String(f.display_name ?? f.name ?? ""),
    codigo: f.default_code ? String(f.default_code) : null,
    unidad: unidad?.nombre ?? null,
    unidadId: unidad?.id ?? null,
    categoria: categoria?.nombre ?? null,
    categoriaId: categoria?.id ?? null,
    yaExistia,
  };
}

/** Mock inyectable en tests: no habla con Odoo. */
export const crearProductoMock: AdaptadorCrearProducto = (vals) =>
  Promise.resolve({
    id: 9001,
    templateId: 9001,
    nombre: vals.nombre,
    codigo: vals.codigo ?? null,
    unidad: null,
    unidadId: vals.uomId ?? null,
    categoria: null,
    categoriaId: vals.categId ?? null,
    yaExistia: false,
  });

export function crearProductoReal(odoo: () => OdooClient): AdaptadorCrearProducto {
  return async (vals) => {
    const c = odoo();
    const dominioExistente: unknown[] = [["active", "=", true], ...(["|", ["company_id", "=", false], ["company_id", "=", c.companyId]])];
    if (vals.codigo) dominioExistente.push(["default_code", "=", vals.codigo]);
    else dominioExistente.push(["name", "=", vals.nombre], ["default_code", "=", false]);
    const ya = await c.call("product.product", "search_read", [dominioExistente], {
      fields: ["id", "display_name", "default_code", "uom_id", "categ_id", "product_tmpl_id"],
      limit: 1,
    }) as Record<string, unknown>[];
    if (ya[0]) return desdeFila(ya[0], true);

    const payload: Record<string, unknown> = {
      name: vals.nombre,
      type: "product",
      purchase_ok: true,
      sale_ok: false,
    };
    if (vals.codigo) payload.default_code = vals.codigo;
    if (vals.categId) payload.categ_id = vals.categId;
    if (vals.uomId) {
      payload.uom_id = vals.uomId;
      payload.uom_po_id = vals.uomId;
    }
    const id = await c.call("product.product", "create", [payload]) as number;
    if (typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0) {
      throw new OdooError("odoo_error", "Odoo no devolvió el id del producto creado.");
    }
    const filas = await c.call("product.product", "search_read", [[["id", "=", id]]], {
      fields: ["id", "display_name", "default_code", "uom_id", "categ_id", "product_tmpl_id"],
      limit: 1,
    }) as Record<string, unknown>[];
    if (!filas[0]) throw new OdooError("odoo_error", "El producto se creó en Odoo pero no se pudo releer.");
    return desdeFila(filas[0], false);
  };
}
