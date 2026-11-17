// _shared/odoo-corte.ts -- DS-29: apertura por bodega y comparacion SGC = quant. Puro (sin red); APAGADO por flags.
// La apertura NUNCA escribe `quantity` directo en Odoo (DS-22): produce el plan de ajustes (delta por producto) que la accion
// de negocio de inventario de Odoo aplica con la fecha de corte. Aqui solo se calcula y se valida el plan.
export interface SaldoComparable { productId: number; cantidad: number }
export interface AjusteApertura { productId: number; delta: number }

/** Plan de apertura: delta = saldo SGC - quant de Odoo (cero = nada que ajustar). Productos solo en Odoo bajan a 0 en el corte. */
export function planificarApertura(sgc: SaldoComparable[], odoo: SaldoComparable[]): AjusteApertura[] {
  const o = new Map(odoo.map((x) => [x.productId, x.cantidad]));
  const s = new Map(sgc.map((x) => [x.productId, x.cantidad]));
  const out: AjusteApertura[] = [];
  for (const id of new Set([...o.keys(), ...s.keys()])) {
    const delta = Math.round(((s.get(id) ?? 0) - (o.get(id) ?? 0)) * 1e6) / 1e6;
    if (delta !== 0) out.push({ productId: id, delta });
  }
  return out.sort((a, b) => a.productId - b.productId);
}

/** El corte es valido solo si la fecha no es futura y el plan no ajusta mas de `maxFraccion` del stock (evita una apertura mal cargada). */
export function validarCorte(fechaCorte: string, hoy: string, plan: AjusteApertura[], sgc: SaldoComparable[], maxFraccion = 0.5): string | null {
  if (fechaCorte > hoy) return "La fecha de corte no puede ser futura.";
  const total = sgc.reduce((t, x) => t + Math.abs(x.cantidad), 0);
  const mover = plan.reduce((t, x) => t + Math.abs(x.delta), 0);
  if (total > 0 && mover / total > maxFraccion) return "La apertura ajusta demasiado stock: revisa el conteo antes de continuar.";
  return null;
}

// ── DS-29 (W2): aplicar la apertura de UNA bodega en Odoo con la accion de negocio de inventario (reutiliza odoo-ajustes.ts) ──────────────
import type { LlamadorOdoo } from "./odoo-traslados.ts";
import { ajustarArticulo, type ResultadoLineaAjuste } from "./odoo-ajustes.ts";
import { TrasladoError, traducirErrorOdoo } from "./odoo-traslados.ts";

export const refApertura = (bodegaId: string) => `SGC-APERT-${bodegaId}`;

export interface DatosApertura { fase_corte: boolean; configurada: boolean; fecha_corte: string | null; apertura_hecha: boolean; hoy: string; location_id: number | null; saldos: Array<{ odoo_product_id: number; cantidad: number; nombre?: string }> }
export interface ResultadoApertura { modo: "plan" | "aplicar"; fecha_corte: string; ajustes: AjusteApertura[]; solo_odoo: number; aplicadas?: number; lineas?: ResultadoLineaAjuste[]; ya_hecha?: boolean }

/**
 * Apertura SEGURA: solo se ajustan los articulos HOMOLOGADOS que SGC tiene en esa bodega. Los productos que solo existen en Odoo
 * (la copia de prod trae cientos que SGC no gestiona) NO se tocan -- no se llevan a cero --; se cuentan en `solo_odoo`.
 * `modo: "plan"` solo calcula (sin escribir). `aplicar` lleva cada articulo al saldo SGC (objetivo absoluto, idempotente por `SGC-APERT-<bodega>`).
 */
export async function aplicarAperturaBodega(
  c: LlamadorOdoo, bodegaId: string, datos: DatosApertura, modo: "plan" | "aplicar", tope = 0.5,
): Promise<ResultadoApertura> {
  if (!datos.fase_corte) throw new TrasladoError("estado_invalido", "La fase de corte está apagada: no se puede hacer la apertura.");
  if (!datos.configurada || !datos.fecha_corte) throw new TrasladoError("datos", "Configura primero la fecha de corte de la bodega.");
  if (datos.location_id == null) throw new TrasladoError("datos", "La bodega no está vinculada con Odoo.");
  const quants: Array<{ product_id: [number, string]; quantity: number }> = await c.call("stock.quant", "search_read", [[["location_id", "=", datos.location_id]]], { fields: ["product_id", "quantity"] }) ?? [];
  const odoo = new Map<number, number>();
  for (const q of quants) odoo.set(q.product_id[0], (odoo.get(q.product_id[0]) ?? 0) + Number(q.quantity));
  const sgc = datos.saldos.map((s) => ({ productId: Number(s.odoo_product_id), cantidad: Number(s.cantidad) }));
  const homologados = new Set(sgc.map((s) => s.productId));
  const plan = planificarApertura(sgc, [...odoo].filter(([id]) => homologados.has(id)).map(([productId, cantidad]) => ({ productId, cantidad })));
  const solo_odoo = [...odoo.keys()].filter((id) => !homologados.has(id) && Math.abs(odoo.get(id)!) > 1e-9).length;
  const err = validarCorte(datos.fecha_corte, datos.hoy, plan, sgc, tope);
  if (err) throw new TrasladoError("datos", err);
  if (modo === "plan") return { modo, fecha_corte: datos.fecha_corte, ajustes: plan, solo_odoo };
  const objetivo = new Map(sgc.map((s) => [s.productId, s.cantidad]));
  const lineas: ResultadoLineaAjuste[] = [];
  for (const a of plan) {
    try { lineas.push(await ajustarArticulo(c, { nombre: refApertura(bodegaId), locationId: datos.location_id, productId: a.productId, objetivo: objetivo.get(a.productId)! })); } catch (e) { throw traducirErrorOdoo(e); }
  }
  return { modo, fecha_corte: datos.fecha_corte, ajustes: plan, solo_odoo, aplicadas: lineas.filter((l) => l.estado === "aplicada").length, lineas };
}
