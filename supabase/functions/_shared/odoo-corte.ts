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
