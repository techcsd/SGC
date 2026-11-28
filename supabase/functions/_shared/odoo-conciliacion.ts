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
export type TipoDiscrepancia = "sin_picking_a" | "picking_a_no_validado" | "cantidad_distinta" | "sin_picking_b" | "picking_b_no_validado" | "picking_huerfano" | "transito_vencido" | "fuera_de_canal" | "saldo_distinto";
export interface Discrepancia { tipo: TipoDiscrepancia; salidaId?: string; pickingId?: number; detalle: string; clave?: string }

export const HORAS_TRANSITO_MAX = 72;

/** Clave estable de un hallazgo (una fila por hallazgo en `odoo_discrepancias`). */
export const claveDiscrepancia = (d: Discrepancia): string => `${d.tipo}|${d.salidaId ?? ""}|${d.pickingId ?? ""}${d.clave ? `|${d.clave}` : ""}`;

/** Conteo por tipo de un conjunto de hallazgos (resumen de la corrida). */
export const contarPorTipo = (ds: Discrepancia[]): Record<string, number> => {
  const o: Record<string, number> = {}; for (const d of ds) o[d.tipo] = (o[d.tipo] ?? 0) + 1; return o;
};

/** Mayor write_date visto (marca de agua del sondeo, ADR 17); conserva la anterior si no hay pickings. */
export const avanzarMarca = (pickings: PickingOdoo[], anterior: string | null): string | null =>
  pickings.reduce<string | null>((m, p) => (p.writeDate && (!m || p.writeDate > m) ? p.writeDate : m), anterior);

export interface SaldoSgc { bodegaId: string; bodega: string; locationId: number; articuloId: string; productId: number; cantidad: number }
export interface SaldoOdoo { locationId: number; productId: number; cantidad: number }
/** Saldo SGC vs `stock.quant` por (ubicacion, producto) de bodegas homologadas. Tolerancia de 1e-6. */
export function conciliarSaldos(sgc: SaldoSgc[], odoo: SaldoOdoo[]): Discrepancia[] {
  const o = new Map(odoo.map((q) => [`${q.locationId}:${q.productId}`, q.cantidad]));
  const vistos = new Set<string>();
  const out: Discrepancia[] = [];
  for (const s of sgc) {
    const k = `${s.locationId}:${s.productId}`; vistos.add(k);
    const q = o.get(k) ?? 0;
    if (Math.abs(q - s.cantidad) > 1e-6) out.push({ tipo: "saldo_distinto", clave: `${s.bodegaId}:${s.articuloId}`, detalle: `${s.bodega}: SGC ${s.cantidad} vs Odoo ${q}.` });
  }
  return out;
}

const suma = (xs: Array<{ productId: number; cantidad: number }>) => {
  const m = new Map<number, number>(); for (const x of xs) m.set(x.productId, (m.get(x.productId) ?? 0) + x.cantidad); return m;
};
const iguales = (a: Map<number, number>, b: Map<number, number>) => a.size === b.size && [...a].every(([k, v]) => Math.abs((b.get(k) ?? NaN) - v) < 1e-6);

/** Estados que exigen A y/o B en Odoo, segun el estado de la salida. */
export function conciliarSalidas(salidas: SalidaConciliable[], pickings: PickingOdoo[], ahora: Date = new Date(), horasMax: number = HORAS_TRANSITO_MAX): Discrepancia[] {
  const out: Discrepancia[] = [];
  const porOrigin = new Map(pickings.map((p) => [p.origin, p]));
  const conocidas = new Set<string>();
  // W3: un picking es huerfano solo si NINGUNA salida de SGC lo reclama, en cualquier estado (anulada, rechazada o pasada a prueba tambien:
  // sus pickings devueltos/complementos/de faltante son legitimos y no son deriva).
  const idsSgc = new Set(salidas.map((s) => s.id));
  const salidaDe = (origin: string): string | null => origin.match(/^SGC-TRAS-(.+?)-(?:A|B|F[^-]*)(?:-C[^-]*)?(?:-D\d+)?$/)?.[1] ?? null;
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
      if (horas > horasMax) out.push({ tipo: "transito_vencido", salidaId: s.id, pickingId: A.id, detalle: `Material en tránsito hace ${Math.floor(horas)} h (límite ${horasMax} h).` });
    }
  }
  for (const p of pickings) {
    if (p.state === "cancel" || p.origin.startsWith(`${PREFIJO_ORIGIN}TEST-`)) continue; // pruebas de contrato (SGC-TRAS-TEST-*) no son deriva
    // (cancelado) // un borrador cancelado (p.ej. despacho sin stock) no es deriva
    const base = p.origin.replace(/-D\d+$/, "");
    const duena = salidaDe(p.origin);
    if (!conocidas.has(base) && !(duena && idsSgc.has(duena))) out.push({ tipo: "picking_huerfano", pickingId: p.id, detalle: `El picking ${p.origin} no corresponde a ninguna salida de SGC.` });
  }
  return out;
}

/** Pickings editados a mano: `write_uid` distinto de la cuenta tecnica (solo los de origen SGC) o sin origen SGC en almacenes vigilados. */
export function fueraDeCanal(pickings: PickingOdoo[], tecnicoUid: number): Discrepancia[] {
  return pickings
    // Pruebas de contrato (SGC-TRAS-TEST-*, SGC-TRAS-prueba-*) y pickings cancelados no son deriva.
    .filter((p) => p.state !== "cancel" && !/^SGC-TRAS-(TEST|prueba)-/.test(p.origin))
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

/** Pickings validados SIN origen SGC en almacenes vigilados (movimientos hechos a mano / fuera de canal). Solo lectura. */
export async function leerPickingsFueraDeCanal(c: LlamadorOdoo, warehouseIds: number[], desde?: string): Promise<PickingOdoo[]> {
  if (!warehouseIds.length) return [];
  const dom: Any[] = [["state", "=", "done"], ["picking_type_id.warehouse_id", "in", warehouseIds], ["origin", "not like", `${PREFIJO_ORIGIN}%`]];
  if (desde) dom.push(["write_date", ">=", desde]);
  const ps = await c.call("stock.picking", "search_read", [dom], { fields: ["origin", "state", "write_date", "write_uid"], limit: 500, order: "id desc" });
  return (ps ?? []).map((p: Any) => ({ id: p.id, origin: typeof p.origin === "string" ? p.origin : "", state: p.state, writeDate: p.write_date, writeUid: p.write_uid?.[0] ?? null, moves: [] }));
}

/** EB-10: saldos de TODO el arbol bajo una ubicacion (child_of), por (ubicacion, producto). El stock «global» del almacen es la suma de sus hijas. */
export async function leerQuantsArbol(c: LlamadorOdoo, rootLocationId: number): Promise<SaldoOdoo[]> {
  const g = await c.call("stock.quant", "read_group", [[["location_id", "child_of", rootLocationId], ["location_id.usage", "=", "internal"]], ["quantity:sum"], ["location_id", "product_id"]], { lazy: false, limit: 20000 });
  return (g ?? []).map((r: Any) => ({ locationId: r.location_id?.[0], productId: r.product_id?.[0], cantidad: Number(r.quantity ?? 0) })).filter((q: SaldoOdoo) => q.locationId && q.productId);
}

/** EB-10: total por producto de un conjunto de saldos por ubicacion (lo que va a stock_por_bodega: una fila por producto). */
export function agregarPorProducto(saldos: SaldoOdoo[]): SaldoOdoo[] {
  const m = new Map<number, number>();
  for (const s of saldos) m.set(s.productId, (m.get(s.productId) ?? 0) + s.cantidad);
  return [...m].map(([productId, cantidad]) => ({ locationId: 0, productId, cantidad }));
}

export interface UbicacionOdoo { odoo_location_id: number; padre_odoo_location_id: number | null; nombre: string; ruta: string; activa: boolean }

/** EB-09: arbol de ubicaciones internas activas bajo la ubicacion de un almacen (incluida la raiz). */
export async function leerArbolUbicaciones(c: LlamadorOdoo, rootLocationId: number): Promise<UbicacionOdoo[]> {
  const ls = await c.call("stock.location", "search_read", [[["location_id", "child_of", rootLocationId], ["usage", "=", "internal"], ["active", "=", true]]], { fields: ["name", "complete_name", "location_id"], limit: 500, order: "complete_name asc" });
  return (ls ?? []).map((l: Any) => ({
    odoo_location_id: l.id, padre_odoo_location_id: l.id === rootLocationId ? null : (l.location_id?.[0] ?? null),
    nombre: String(l.name ?? ""), ruta: String(l.complete_name ?? l.name ?? ""), activa: true,
  }));
}

/** Saldos de `stock.quant` por (ubicacion, producto) para las ubicaciones indicadas (read_group, sin sububicaciones). */
export async function leerQuants(c: LlamadorOdoo, locationIds: number[]): Promise<SaldoOdoo[]> {
  if (!locationIds.length) return [];
  const g = await c.call("stock.quant", "read_group", [[["location_id", "in", locationIds]], ["quantity:sum"], ["location_id", "product_id"]], { lazy: false, limit: 20000 });
  return (g ?? []).map((r: Any) => ({ locationId: r.location_id?.[0], productId: r.product_id?.[0], cantidad: Number(r.quantity ?? 0) })).filter((q: SaldoOdoo) => q.locationId && q.productId);
}
