// _shared/odoo-pendientes.ts -- «Pendientes en Odoo»: lo que el tablero de Inventario de Odoo cuenta como «Por procesar» / «Atrasado»
// (recepciones, entregas e internos sin validar ni cancelar). SOLO LECTURA sobre Odoo. La foto se guarda en sgc.odoo_pendientes
// y se cruza con las OC y los conduces que SGC ya conoce (para distinguir lo que SGC publico de lo que solo vive en Odoo).
import type { LlamadorOdoo } from "./odoo-traslados.ts";

// deno-lint-ignore no-explicit-any
type Any = any;
export type TipoPendiente = "recepcion" | "entrega" | "interno" | "otro";
export interface FilaPendiente {
  picking_id: number; nombre: string; origin: string; tipo: TipoPendiente; estado: string; programada: string | null;
  almacen: string | null; odoo_warehouse_id: number | null; oc_odoo_id: number | null;
}

export const tipoDeOperacion = (code: unknown): TipoPendiente => code === "incoming" ? "recepcion" : code === "outgoing" ? "entrega" : code === "internal" ? "interno" : "otro";
const aIso = (s: unknown): string | null => (typeof s === "string" && s ? `${s.replace(" ", "T")}Z` : null); // Odoo guarda UTC sin zona

/** Puro: arma las filas a partir de lo leido en Odoo. `ocPorNombre` mapea el nombre de la OC (origin del picking) a su id. */
export function armarPendientes(pickings: Any[], tipos: Any[], ocPorNombre: Map<string, number>): FilaPendiente[] {
  const t = new Map<number, Any>(tipos.map((x) => [x.id, x]));
  return pickings.map((p) => {
    const tp = t.get(p.picking_type_id?.[0]);
    const origin = typeof p.origin === "string" ? p.origin : "";
    return {
      picking_id: p.id, nombre: String(p.name ?? p.id), origin, tipo: tipoDeOperacion(tp?.code), estado: String(p.state),
      programada: aIso(p.scheduled_date), almacen: tp?.warehouse_id?.[1] ?? null, odoo_warehouse_id: tp?.warehouse_id?.[0] ?? null,
      oc_odoo_id: ocPorNombre.get(origin) ?? null,
    };
  });
}

export async function leerPendientes(c: LlamadorOdoo): Promise<FilaPendiente[]> {
  const pickings: Any[] = await c.call("stock.picking", "search_read", [[["state", "not in", ["done", "cancel"]]]], { fields: ["name", "origin", "state", "picking_type_id", "scheduled_date"], limit: 2000, order: "scheduled_date asc" }) ?? [];
  if (!pickings.length) return [];
  const tipos: Any[] = await c.call("stock.picking.type", "search_read", [[]], { fields: ["code", "warehouse_id"], limit: 500, context: { active_test: false } }) ?? [];
  const origenes = [...new Set(pickings.map((p) => p.origin).filter((o: unknown) => typeof o === "string" && /^P\d+/.test(o)))];
  const ocs: Any[] = origenes.length ? await c.call("purchase.order", "search_read", [[["name", "in", origenes]]], { fields: ["name"], limit: 2000 }) ?? [] : [];
  return armarPendientes(pickings, tipos, new Map(ocs.map((o) => [String(o.name), Number(o.id)])));
}
