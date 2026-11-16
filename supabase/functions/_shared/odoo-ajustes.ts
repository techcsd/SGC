// _shared/odoo-ajustes.ts -- DS-22 (#15): conteos, ajustes y apertura -> inventario de Odoo.
//
// MAPEO DE LAS TRES SEMANTICAS (documentado tambien en docs/ODOO-CIRCUITO2.md):
//   conteo fisico APLICADO / ajuste individual / ajuste real en lote
//        -> cantidad objetivo ABSOLUTA por articulo y ubicacion: se publica con la accion de negocio de Odoo
//           (`stock.quant.inventory_quantity` + `action_apply_inventory`), nunca escribiendo `quantity` directo.
//           El movimiento resultante lleva el nombre `SGC-AJU-<conteo>` (idempotencia y auditoria en Odoo).
//   borrador / contado (autoguardado)   -> NO publica nada (criterio 2).
//   deshacer (aplicado -> cancelado)    -> COMPENSACION relativa: se revierte el delta que SGC aplico, no se restaura un saldo
//                                          antiguo a ciegas (si hubo movimientos posteriores quedan intactos) -- criterio 5.
//   apertura (saldo inicial / corte)    -> NO se publica como ajuste: sumaria el saldo inicial sobre la historia ya importada
//                                          (criterio 4). Requiere fecha de corte y conciliacion (DS-29); queda fuera de este publicador.
import type { LlamadorOdoo } from "./odoo-traslados.ts";
import { TrasladoError, traducirErrorOdoo } from "./odoo-traslados.ts";
import { clasificarFallo, exito, type Marcar, omitido, type ResultadoEvento } from "./odoo-evento.ts";

// deno-lint-ignore no-explicit-any
type Any = any;
const EPS = 1e-6;
export const refAjuste = (conteoId: string) => `SGC-AJU-${conteoId}`;

export interface ResultadoLineaAjuste { productId: number; antes: number; despues: number; delta: number; estado: "aplicada" | "sin_cambio" | "reutilizada" }

/** `action_apply_inventory` devuelve None y XML-RPC lo reporta como fault «cannot marshal None» aunque SI se aplico (medido en staging). */
async function aplicarInventario(c: LlamadorOdoo, quantId: number, nombre: string): Promise<void> {
  try {
    await c.call("stock.quant", "action_apply_inventory", [[quantId]], { context: { inventory_name: nombre } });
  } catch (e) {
    if (!(e instanceof Error && /cannot marshal None/i.test(e.message))) throw e; // el resultado se verifica releyendo el saldo
  }
}

async function saldoQuants(c: LlamadorOdoo, locationId: number, productId: number): Promise<{ ids: number[]; cantidad: number }> {
  const q: Any[] = await c.call("stock.quant", "search_read", [[["location_id", "=", locationId], ["product_id", "=", productId]]], { fields: ["quantity"] });
  return { ids: q.map((x) => x.id), cantidad: q.reduce((s, x) => s + Number(x.quantity ?? 0), 0) };
}

/** Lleva UN articulo de una ubicacion a la cantidad objetivo con la accion de negocio de Odoo. Idempotente por (nombre, producto). */
export async function ajustarArticulo(
  c: LlamadorOdoo, p: { nombre: string; locationId: number; productId: number; objetivo: number },
): Promise<ResultadoLineaAjuste> {
  if (!Number.isFinite(p.objetivo) || p.objetivo < 0) throw new TrasladoError("datos", "La cantidad contada no es válida.");
  const hechos: Any[] = await c.call("stock.move", "search_read", [[["name", "=", p.nombre], ["product_id", "=", p.productId], ["state", "=", "done"]]], { fields: ["quantity"], limit: 1 });
  const s = await saldoQuants(c, p.locationId, p.productId);
  if (hechos.length) return { productId: p.productId, antes: s.cantidad, despues: s.cantidad, delta: 0, estado: "reutilizada" };
  if (Math.abs(s.cantidad - p.objetivo) < EPS) return { productId: p.productId, antes: s.cantidad, despues: s.cantidad, delta: 0, estado: "sin_cambio" };
  if (s.ids.length > 1) throw new TrasladoError("datos", "El artículo tiene varios lotes o paquetes en esa ubicación de Odoo; ajústalo allá.", `quants=${s.ids.length}`);
  let quantId = s.ids[0];
  const ctx = { context: { inventory_mode: true } };
  if (quantId) await c.call("stock.quant", "write", [[quantId], { inventory_quantity: p.objetivo }], ctx);
  else quantId = await c.call("stock.quant", "create", [{ product_id: p.productId, location_id: p.locationId, inventory_quantity: p.objetivo }], ctx);
  await aplicarInventario(c, quantId, p.nombre);
  const d = await saldoQuants(c, p.locationId, p.productId);
  if (Math.abs(d.cantidad - p.objetivo) > EPS) {
    throw new TrasladoError("estado_invalido", "Odoo no dejó el saldo esperado tras el ajuste; requiere conciliación.", `esperado=${p.objetivo} real=${d.cantidad}`);
  }
  return { productId: p.productId, antes: s.cantidad, despues: d.cantidad, delta: d.cantidad - s.cantidad, estado: "aplicada" };
}

/** Delta neto que un ajuste `nombre` dejo en la ubicacion, por producto (a partir de los movimientos de Odoo). */
export async function deltasAplicados(c: LlamadorOdoo, nombre: string, locationId: number): Promise<Map<number, number>> {
  const mv: Any[] = await c.call("stock.move", "search_read", [[["name", "=", nombre], ["state", "=", "done"]]], { fields: ["product_id", "quantity", "location_id", "location_dest_id"] });
  const m = new Map<number, number>();
  for (const x of mv) {
    const pid = x.product_id[0]; let d = m.get(pid) ?? 0;
    if (x.location_dest_id[0] === locationId) d += Number(x.quantity);
    if (x.location_id[0] === locationId) d -= Number(x.quantity);
    m.set(pid, d);
  }
  return m;
}

/** Deshacer: revierte SOLO el delta aplicado (relativo al saldo actual). Idempotente por `<ref>-REV`. */
export async function compensarAjuste(c: LlamadorOdoo, p: { ref: string; locationId: number }): Promise<ResultadoLineaAjuste[]> {
  const deltas = await deltasAplicados(c, p.ref, p.locationId);
  const out: ResultadoLineaAjuste[] = [];
  for (const [productId, delta] of deltas) {
    if (Math.abs(delta) < EPS) continue;
    const s = await saldoQuants(c, p.locationId, productId);
    out.push(await ajustarArticulo(c, { nombre: `${p.ref}-REV`, locationId: p.locationId, productId, objetivo: Math.max(0, s.cantidad - delta) }));
  }
  return out;
}

export interface LineaConteo { nombre: string; odooProductId: number | null; cantidadContada: number | null }
export interface DatosConteo {
  id: string; tipo: string; estado: "borrador" | "contado" | "aplicado" | "cancelado" | string; esPrueba: boolean; motivo?: string | null;
  bodegaLocationId: number | null; lineas: LineaConteo[];
}
export interface DepsConteo { c: LlamadorOdoo; cargar(id: string): Promise<DatosConteo | null>; marcar: Marcar }

export async function publicarConteo(d: DepsConteo, conteoId: string, intentos: number): Promise<ResultadoEvento> {
  const k = await d.cargar(conteoId);
  if (!k) return { estado: "error", error: "El conteo ya no existe en SGC." };
  const id = k.id;
  try {
    if (k.esPrueba) return { estado: "completado", resultado: { omitido: "es_prueba" } };
    if (k.estado === "borrador" || k.estado === "contado") return await omitido(d.marcar, id, "no_aplicado", "Conteo sin aplicar: no se publica en Odoo hasta que se aplique.", null);
    if (k.bodegaLocationId == null) throw new TrasladoError("datos", "El almacén del conteo no está vinculado con Odoo.");
    const ref = refAjuste(id);
    if (k.estado === "cancelado") {
      const comp = await compensarAjuste(d.c, { ref, locationId: k.bodegaLocationId });
      if (!comp.length) return await omitido(d.marcar, id, "sin_efecto_previo", "Conteo cancelado sin efecto previo en Odoo.", null);
      return await exito(d.marcar, id, undefined, { compensado: true, lineas: comp }, "Conteo deshecho: se compensó el ajuste en Odoo.");
    }
    if (k.estado !== "aplicado") return await omitido(d.marcar, id, "estado_desconocido", `Estado de conteo no publicable (${k.estado}).`, null);

    const lineas = k.lineas.filter((l) => l.cantidadContada != null);
    if (!lineas.length) return await omitido(d.marcar, id, "sin_lineas", "El conteo no tiene cantidades contadas.", null);
    const sin = lineas.filter((l) => !l.odooProductId);
    if (sin.length) throw new TrasladoError("datos", `Hay artículos sin vincular con Odoo (${sin.slice(0, 3).map((l) => l.nombre).join(", ")}). Vincúlalos y reintenta.`);
    const res: ResultadoLineaAjuste[] = [];
    for (const l of lineas) {
      try {
        res.push(await ajustarArticulo(d.c, { nombre: ref, locationId: k.bodegaLocationId, productId: l.odooProductId!, objetivo: l.cantidadContada! }));
      } catch (e) {
        throw traducirErrorOdoo(e);
      }
    }
    const aplicadas = res.filter((r) => r.estado === "aplicada").length;
    return await exito(d.marcar, id, undefined, { lineas: res, aplicadas }, aplicadas ? undefined : "Sin diferencias contra Odoo: no hubo nada que ajustar.");
  } catch (err) {
    return await clasificarFallo(err, id, intentos, d.marcar);
  }
}
