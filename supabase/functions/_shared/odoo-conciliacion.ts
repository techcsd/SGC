// _shared/odoo-conciliacion.ts -- DS-13: conciliador SGC <-> Odoo de traslados (solo lectura sobre Odoo).
// Compara cada salida publicada con sus pickings A/B por `origin` (SGC-TRAS-<salida>-A|B), detecta pickings SGC sin salida,
// stock en transito vencido (> 72 h sin paso B) y pickings «fuera de canal» (editados/creados a mano en almacenes piloto).
// Es puro sobre datos ya leidos: `leerTrasladosSgc` es la unica funcion que toca Odoo (y solo lee).
import { PREFIJO_ORIGIN, type LlamadorOdoo } from "./odoo-traslados.ts";

export interface SalidaConciliable {
  id: string; estado: string; esPrueba: boolean; despachadaEn: string | null; // ISO
  lineas: Array<{ odooProductId: number; cantidad: number; cantidadRecibida: number | null }>;
}
export interface PickingOdoo { id: number; origin: string; state: string; writeDate: string; writeUid: number | null; moves: Array<{ productId: number; cantidad: number }> }
export type TipoDiscrepancia = "sin_picking_a" | "picking_a_no_validado" | "cantidad_distinta" | "sin_picking_b" | "picking_b_no_validado" | "picking_huerfano" | "transito_vencido" | "fuera_de_canal";
export interface Discrepancia { tipo: TipoDiscrepancia; salidaId?: string; pickingId?: number; detalle: string }

export const HORAS_TRANSITO_MAX = 72;

const suma = (xs: Array<{ productId: number; cantidad: number }>) => {
  const m = new Map<number, number>(); for (const x of xs) m.set(x.productId, (m.get(x.productId) ?? 0) + x.cantidad); return m;
};
const iguales = (a: Map<number, number>, b: Map<number, number>) => a.size === b.size && [...a].every(([k, v]) => Math.abs((b.get(k) ?? NaN) - v) < 1e-6);

/** Estados que exigen A y/o B en Odoo, segun el estado de la salida. */
export function conciliarSalidas(salidas: SalidaConciliable[], pickings: PickingOdoo[], ahora: Date = new Date()): Discrepancia[] {
  const out: Discrepancia[] = [];
  const porOrigin = new Map(pickings.map((p) => [p.origin, p]));
  const conocidas = new Set<string>();
  for (const s of salidas) {
    if (s.esPrueba || s.estado === "anulado" || s.estado === "rechazada") continue;
    conocidas.add(`${PREFIJO_ORIGIN}${s.id}-A`); conocidas.add(`${PREFIJO_ORIGIN}${s.id}-B`);
    const A = porOrigin.get(`${PREFIJO_ORIGIN}${s.id}-A`); const B = porOrigin.get(`${PREFIJO_ORIGIN}${s.id}-B`);
    if (!A) { out.push({ tipo: "sin_picking_a", salidaId: s.id, detalle: "La salida no tiene el traslado A en Odoo." }); continue; }
    if (A.state !== "done") out.push({ tipo: "picking_a_no_validado", salidaId: s.id, pickingId: A.id, detalle: `A está en estado ${A.state}.` });
    else if (!iguales(suma(s.lineas.map((l) => ({ productId: l.odooProductId, cantidad: l.cantidad }))), suma(A.moves))) {
      out.push({ tipo: "cantidad_distinta", salidaId: s.id, pickingId: A.id, detalle: "Las cantidades de A no coinciden con el conduce." });
    }
    const entregada = s.estado === "entregado" || s.estado === "entregado_incompleto";
    if (entregada) {
      if (!B) out.push({ tipo: "sin_picking_b", salidaId: s.id, detalle: "El conduce está entregado y falta el traslado B en Odoo." });
      else if (B.state !== "done") out.push({ tipo: "picking_b_no_validado", salidaId: s.id, pickingId: B.id, detalle: `B está en estado ${B.state}.` });
      else if (!iguales(suma(s.lineas.map((l) => ({ productId: l.odooProductId, cantidad: l.cantidadRecibida ?? l.cantidad })).filter((x) => x.cantidad > 0)), suma(B.moves))) {
        out.push({ tipo: "cantidad_distinta", salidaId: s.id, pickingId: B.id, detalle: "Las cantidades de B no coinciden con lo recibido." });
      }
    } else if (A.state === "done" && !B && s.despachadaEn) {
      const horas = (ahora.getTime() - new Date(s.despachadaEn).getTime()) / 3_600_000;
      if (horas > HORAS_TRANSITO_MAX) out.push({ tipo: "transito_vencido", salidaId: s.id, pickingId: A.id, detalle: `Material en tránsito hace ${Math.floor(horas)} h (límite ${HORAS_TRANSITO_MAX} h).` });
    }
  }
  for (const p of pickings) {
    if (p.state === "cancel") continue; // un borrador cancelado (p.ej. despacho sin stock) no es deriva
    const base = p.origin.replace(/-D\d+$/, "");
    if (!conocidas.has(base)) out.push({ tipo: "picking_huerfano", pickingId: p.id, detalle: `El picking ${p.origin} no corresponde a ninguna salida activa de SGC.` });
  }
  return out;
}

/** Pickings editados a mano: `write_uid` distinto de la cuenta tecnica (solo los de origen SGC) o sin origen SGC en almacenes vigilados. */
export function fueraDeCanal(pickings: PickingOdoo[], tecnicoUid: number): Discrepancia[] {
  return pickings
    .filter((p) => (p.origin.startsWith(PREFIJO_ORIGIN) && p.writeUid != null && p.writeUid !== tecnicoUid) || (!p.origin.startsWith(PREFIJO_ORIGIN) && p.state === "done"))
    .map((p) => ({ tipo: "fuera_de_canal" as const, pickingId: p.id, detalle: p.origin.startsWith(PREFIJO_ORIGIN) ? "Picking SGC modificado por otro usuario de Odoo." : "Movimiento validado fuera de SGC en un almacén vigilado." }));
}

// ── Lectura de Odoo (solo lectura) ─────────────────────────────────────────
// deno-lint-ignore no-explicit-any
type Any = any;
export async function leerTrasladosSgc(c: LlamadorOdoo, filtro: { desde?: string; origen?: string } = {}): Promise<PickingOdoo[]> {
  const dom: Any[] = [["origin", "=like", filtro.origen ?? `${PREFIJO_ORIGIN}%`]];
  if (filtro.desde) dom.push(["write_date", ">=", filtro.desde]);
  const ps = await c.call("stock.picking", "search_read", [dom], { fields: ["origin", "state", "write_date", "write_uid"], limit: 2000, order: "id asc" });
  if (!ps.length) return [];
  const moves = await c.call("stock.move", "search_read", [[["picking_id", "in", ps.map((p: Any) => p.id)]]], { fields: ["picking_id", "product_id", "quantity", "state"], limit: 20000 });
  const porPicking = new Map<number, PickingOdoo["moves"]>();
  for (const m of moves) { if (m.state === "cancel") continue; const k = m.picking_id[0]; (porPicking.get(k) ?? porPicking.set(k, []).get(k)!).push({ productId: m.product_id[0], cantidad: Number(m.quantity) }); }
  return ps.map((p: Any) => ({ id: p.id, origin: p.origin, state: p.state, writeDate: p.write_date, writeUid: p.write_uid?.[0] ?? null, moves: porPicking.get(p.id) ?? [] }));
}
