// _shared/odoo-catalogo.ts — Hotfix Odoo 19: «Odoo manda el catálogo». Lee de Odoo los productos con stock que SGC aún
// no conoce y los deja listos para `sgc.odoo_articulos_importar`. Solo lectura sobre Odoo (product.product.search_read).
import type { LlamadorOdoo } from "./odoo-traslados.ts";

export interface FilaImportacion { product_id: number; template_id: number; codigo: string | null; nombre: string; unidad: string }

const LOTE = 200;

// deno-lint-ignore no-explicit-any
type Any = any;

const m2o = (v: unknown): { id: number; nombre: string } | null =>
  Array.isArray(v) && typeof v[0] === "number" ? { id: v[0], nombre: String(v[1] ?? "") } : null;

/** Producto de Odoo -> fila de importación; null si no sirve (sin nombre o sin plantilla). */
export function aFilaImportacion(p: Any): FilaImportacion | null {
  const nombre = String(p?.name ?? "").replace(/\s+/g, " ").trim();
  const tmpl = m2o(p?.product_tmpl_id);
  if (typeof p?.id !== "number" || !nombre || !tmpl) return null;
  return {
    product_id: p.id,
    template_id: tmpl.id,
    codigo: p.default_code ? String(p.default_code).trim() || null : null,
    nombre,
    unidad: m2o(p.uom_id)?.nombre ?? "Unidad",
  };
}

/** Ids de producto con stock positivo que SGC no conoce (sin repetir). */
export function productosDesconocidos(conStock: Iterable<number>, conocidos: Set<number>): number[] {
  const out = new Set<number>();
  for (const id of conStock) if (!conocidos.has(id)) out.add(id);
  return [...out];
}

/** Lee de Odoo los datos de esos productos (por lotes; incluye archivados, que aún pueden tener stock). */
export async function leerProductosParaImportar(c: LlamadorOdoo, ids: number[]): Promise<FilaImportacion[]> {
  const filas: FilaImportacion[] = [];
  for (let i = 0; i < ids.length; i += LOTE) {
    const lote = ids.slice(i, i + LOTE);
    const res = await c.call("product.product", "search_read", [[["id", "in", lote], ["active", "in", [true, false]]]], {
      fields: ["id", "name", "default_code", "uom_id", "product_tmpl_id"], limit: LOTE,
    });
    for (const p of (res ?? []) as Any[]) { const f = aFilaImportacion(p); if (f) filas.push(f); }
  }
  return filas;
}
