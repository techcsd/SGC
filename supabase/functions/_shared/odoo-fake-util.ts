// Odoo simulado en memoria para las pruebas del circuito 2 (DS-16..DS-22). Solo lo usan los *.test.ts; no es codigo de produccion.
// Reproduce lo medido en staging: backorder con skip_backorder, `action_apply_inventory` que devuelve None, stock negativo permitido.
import { OdooError } from "./odoo-client.ts";
import type { LlamadorOdoo } from "./odoo-traslados.ts";

// deno-lint-ignore no-explicit-any
type Any = any;
const idDe = (v: Any) => (Array.isArray(v) ? v[0] : v);

function cumple(rec: Any, dom: Any[]): boolean {
  return dom.every((t) => {
    const [campo, op, valor] = t as [string, string, Any];
    const v = idDe(rec[campo]);
    if (op === "=") return v === valor || (valor === false && !v);
    if (op === "!=") return v !== valor;
    if (op === "in") return (valor as Any[]).includes(v);
    if (op === "=like") return typeof v === "string" && v.startsWith(String(valor).replace(/%$/, ""));
    if (op === "ilike") return typeof v === "string" && v.toLowerCase().includes(String(valor).toLowerCase());
    throw new Error(`operador no simulado ${op}`);
  });
}

export interface OpcionesFake { stock?: number; falla?: (modelo: string, metodo: string) => Error | null; backorderWizard?: boolean }

export function odooFake(o: OpcionesFake = {}) {
  const pickings: Any[] = []; const moves: Any[] = []; const quants: Any[] = []; const llamadas: string[] = []; const ocs: Any[] = [];
  const locs = [
    { id: 8, usage: "internal", name: "WH/Stock" }, { id: 13, usage: "transit", name: "Transit" }, { id: 1, usage: "supplier", name: "Vendors" },
    { id: 5, usage: "inventory", scrap_location: true, name: "Scrap" }, { id: 6, usage: "inventory", scrap_location: false, name: "Inventory adjustment" },
    { id: 9, usage: "internal", name: "WH/Cuarentena" }, { id: 10, usage: "internal", name: "OBRA/Stock" },
  ];
  const nuevoPicking = (v: Any, mv: Array<[number, number]>, extra: Any = {}) => {
    const id = pickings.length + 1; const ids: number[] = [];
    for (const [pid, q] of mv) { const mid = moves.length + 1; moves.push({ id: mid, picking: id, product_uom: [1, "u"], product_id: [pid, "p" + pid], product_uom_qty: q, quantity: 0, state: "draft", name: "m", location_id: [v.location_id, "x"], location_dest_id: [v.location_dest_id, "y"] }); ids.push(mid); }
    pickings.push({ id, name: `P/${id}`, state: "draft", origin: v.origin ?? false, note: v.note ?? false, location_id: [v.location_id, "x"], location_dest_id: [v.location_dest_id, "y"], picking_type_id: [v.picking_type_id ?? 5, "t"], move_ids: ids, backorder_id: false, ...extra });
    return pickings[pickings.length - 1];
  };
  /** OC confirmada con su recepcion (assigned). lineas = [[producto, cantidad]]. */
  const crearOc = (lineas: Array<[number, number]>, estado = "purchase") => {
    const pk = nuevoPicking({ location_id: 1, location_dest_id: 8, picking_type_id: 11, origin: "P00001" }, lineas, { state: "assigned" });
    for (const m of moves.filter((x) => x.picking === pk.id)) m.state = "assigned";
    const oc = { id: 100 + ocs.length, name: "P00001", state: estado, picking_ids: [pk.id] };
    ocs.push(oc); return { oc, picking: pk };
  };
  const c: LlamadorOdoo = {
    // deno-lint-ignore require-await
    async call(model, method, args = [], kw = {}) {
      llamadas.push(`${model}.${method}`);
      const f = o.falla?.(model, method); if (f) throw f;
      const dom = (args[0] ?? []) as Any[];
      if (model === "purchase.order" && method === "search_read") return ocs.filter((x) => cumple(x, dom));
      if (model === "stock.picking") {
        if (method === "search_read") {
          const r = pickings.filter((p) => cumple(p, dom));
          return kw.order ? r.sort((a, b) => a.id - b.id) : r;
        }
        if (method === "read") return args[0].map((id: number) => pickings.find((p) => p.id === id)).filter(Boolean);
        if (method === "create") {
          const v = args[0]; const mv: Array<[number, number]> = [];
          const ps = v.move_ids_without_package.map(([, , m]: Any) => { mv.push([m.product_id, m.product_uom_qty]); return m; });
          const pk = nuevoPicking(v, mv); void ps; return pk.id;
        }
        const p = pickings.find((x) => x.id === args[0][0]);
        if (method === "write") { Object.assign(p, args[1]); return true; }
        if (method === "action_confirm") { p.state = "confirmed"; for (const m of moves.filter((x) => x.picking === p.id)) m.state = "confirmed"; return true; }
        if (method === "action_assign") { p.state = "assigned"; for (const m of moves.filter((x) => x.picking === p.id && x.state !== "done")) m.state = "assigned"; return true; }
        if (method === "action_cancel") { p.state = "cancel"; return true; }
        if (method === "message_post") return 1;
        if (method === "button_validate") {
          const mp = moves.filter((x) => x.picking === p.id);
          const faltan = mp.filter((m) => m.quantity + 1e-9 < m.product_uom_qty);
          if (faltan.length && !kw.context?.skip_backorder) return { res_model: "stock.backorder.confirmation" };
          if (o.backorderWizard) return { res_model: "stock.immediate.transfer" };
          if (faltan.length) {
            nuevoPicking({ location_id: p.location_id[0], location_dest_id: p.location_dest_id[0], origin: p.origin, note: p.note, picking_type_id: p.picking_type_id[0] },
              faltan.map((m) => [m.product_id[0], m.product_uom_qty - m.quantity] as [number, number]), { state: "assigned", backorder_id: [p.id, p.name] });
            const nuevo = pickings[pickings.length - 1];
            for (const oc of ocs) if (oc.picking_ids.includes(p.id)) oc.picking_ids.push(nuevo.id);
          }
          for (const m of mp) { if (m.quantity > 0) { m.product_uom_qty = m.quantity; m.state = "done"; } else m.state = "cancel"; }
          p.state = "done"; return true;
        }
      }
      if (model === "stock.move") {
        if (method === "read") return args[0].map((id: number) => moves.find((m) => m.id === id));
        if (method === "search_read") return moves.filter((m) => cumple(m, dom));
        if (method === "write") { Object.assign(moves.find((m) => m.id === args[0][0]), args[1]); return true; }
      }
      if (model === "stock.warehouse") return [{ id: 1, in_type_id: [11, "in"], int_type_id: [5, "int"], lot_stock_id: [8, "s"] }];
      if (model === "stock.location") {
        const base = locs.map((l) => ({ active: true, ...l })).filter((l) => cumple(l, dom));
        return base.length || !dom.length ? base : [];
      }
      if (model === "stock.quant") {
        if (method === "read_group") return [{ product_id: [7, "p"], quantity: o.stock ?? 100, reserved_quantity: 0 }];
        if (method === "search_read") return quants.filter((q) => cumple(q, dom));
        if (method === "create") { const q = { id: quants.length + 1, product_id: [args[0].product_id, "p"], location_id: [args[0].location_id, "l"], quantity: 0, inventory_quantity: args[0].inventory_quantity }; quants.push(q); return q.id; }
        const q = quants.find((x) => x.id === args[0][0]);
        if (method === "write") { q.inventory_quantity = args[1].inventory_quantity; return true; }
        if (method === "action_apply_inventory") {
          const delta = q.inventory_quantity - q.quantity;
          moves.push({ id: moves.length + 1, name: kw.context?.inventory_name, product_id: q.product_id, quantity: Math.abs(delta), state: "done",
            location_id: delta > 0 ? [6, "inv"] : q.location_id, location_dest_id: delta > 0 ? q.location_id : [6, "inv"] });
          q.quantity = q.inventory_quantity;
          throw new OdooError("odoo_error", "TypeError: cannot marshal None unless allow_none is enabled", true); // asi responde Odoo de verdad
        }
      }
      throw new Error(`no simulado ${model}.${method}`);
    },
  };
  return { c, pickings, moves, quants, llamadas, ocs, crearOc, nuevoPicking };
}
