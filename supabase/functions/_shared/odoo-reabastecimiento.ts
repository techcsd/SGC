// _shared/odoo-reabastecimiento.ts -- Reabastecimiento: SGC es dueno del minimo/maximo de un articulo; Odoo recibe una regla de reabastecimiento
// (stock.warehouse.orderpoint) en el almacen central, con disparador MANUAL (aparece en Inventario > Aprovisionamiento > Reabastecimiento como
// sugerencia; nunca crea compras solo). Una regla que SGC creo y cuyo minimo se quito se ARCHIVA (no se borra). Idempotente.
import type { LlamadorOdoo } from "./odoo-traslados.ts";

// deno-lint-ignore no-explicit-any
type Any = any;
export interface ArticuloMin { articuloId: string; productId: number; minimo: number; maximo: number }
export interface ReglaSgc { articuloId: string; orderpointId: number; productId: number; minimo: number; maximo: number; activa: boolean; protegida?: boolean }
export type Accion =
  | { op: "crear"; articuloId: string; productId: number; minimo: number; maximo: number }
  | { op: "actualizar"; articuloId: string; orderpointId: number; minimo: number; maximo: number }
  | { op: "reactivar"; articuloId: string; orderpointId: number; minimo: number; maximo: number }
  | { op: "archivar"; articuloId: string; orderpointId: number };

const EPS = 1e-6;
/** Puro: que hay que hacer en Odoo para que las reglas coincidan con los minimos de SGC. */
export function planificarReglas(articulos: ArticuloMin[], reglas: ReglaSgc[]): Accion[] {
  const out: Accion[] = [];
  const porArt = new Map(reglas.map((r) => [r.articuloId, r]));
  const vigentes = new Set<string>();
  for (const a of articulos) {
    vigentes.add(a.articuloId);
    const maximo = Math.max(a.maximo, a.minimo);
    const r = porArt.get(a.articuloId);
    if (!r) out.push({ op: "crear", articuloId: a.articuloId, productId: a.productId, minimo: a.minimo, maximo });
    else if (r.protegida) continue; // editada en Odoo: SGC no la pisa
    else if (!r.activa) out.push({ op: "reactivar", articuloId: a.articuloId, orderpointId: r.orderpointId, minimo: a.minimo, maximo });
    else if (Math.abs(r.minimo - a.minimo) > EPS || Math.abs(r.maximo - maximo) > EPS) out.push({ op: "actualizar", articuloId: a.articuloId, orderpointId: r.orderpointId, minimo: a.minimo, maximo });
  }
  for (const r of reglas) if (r.activa && !vigentes.has(r.articuloId) && !r.protegida) out.push({ op: "archivar", articuloId: r.articuloId, orderpointId: r.orderpointId });
  return out;
}

export interface ResultadoRegla { articuloId: string; op: Accion["op"]; orderpointId: number; minimo: number; maximo: number; activa: boolean }

/** Aplica el plan en Odoo. Antes de crear busca una regla existente del mismo producto/almacen (activa o archivada) y la adopta. */
export async function aplicarReglas(c: LlamadorOdoo, destino: { warehouseId: number; locationId: number }, acciones: Accion[]): Promise<ResultadoRegla[]> {
  const out: ResultadoRegla[] = [];
  for (const a of acciones) {
    if (a.op === "archivar") {
      await c.call("stock.warehouse.orderpoint", "write", [[a.orderpointId], { active: false }]);
      out.push({ articuloId: a.articuloId, op: a.op, orderpointId: a.orderpointId, minimo: 0, maximo: 0, activa: false });
      continue;
    }
    const vals = { product_min_qty: a.minimo, product_max_qty: a.maximo, trigger: "manual", active: true };
    if (a.op === "crear") {
      const ya: Any[] = await c.call("stock.warehouse.orderpoint", "search_read", [[["product_id", "=", a.productId], ["warehouse_id", "=", destino.warehouseId]]], { fields: ["id", "product_min_qty", "product_max_qty"], limit: 1, context: { active_test: false } }) ?? [];
      let id = ya[0]?.id as number | undefined;
      if (id) {
        const liveMin = Number(ya[0]?.product_min_qty ?? 0);
        const liveMax = Number(ya[0]?.product_max_qty ?? 0);
        // Si Odoo ya tiene otros mínimos, fue editada allá: no pisar.
        if (Math.abs(liveMin - a.minimo) > EPS || Math.abs(liveMax - a.maximo) > EPS) {
          out.push({ articuloId: a.articuloId, op: a.op, orderpointId: id, minimo: liveMin, maximo: liveMax, activa: true });
          continue;
        }
        await c.call("stock.warehouse.orderpoint", "write", [[id], vals]);
      } else id = await c.call("stock.warehouse.orderpoint", "create", [{ product_id: a.productId, warehouse_id: destino.warehouseId, location_id: destino.locationId, ...vals }]) as number;
      out.push({ articuloId: a.articuloId, op: a.op, orderpointId: id, minimo: a.minimo, maximo: a.maximo, activa: true });
    } else {
      await c.call("stock.warehouse.orderpoint", "write", [[a.orderpointId], vals]);
      out.push({ articuloId: a.articuloId, op: a.op, orderpointId: a.orderpointId, minimo: a.minimo, maximo: a.maximo, activa: true });
    }
  }
  return out;
}
