// _shared/odoo-recepciones.ts -- DS-16 (#9) / DS-19 (#12, lado entrada): publica una ENTRADA de inventario de SGC en Odoo.
//
// Decision por tipo de entrada (todo idempotente; el worker puede reprocesar sin sumar dos veces):
//   pendiente de confirmacion        -> NO se publica (criterio 1: sin hecho fisico no hay stock ERP).
//   rechazada                        -> NO se publica; el rechazo nunca materializa stock (criterio 5).
//   es_prueba                        -> NO se publica; si ya habia efecto en Odoo se compensa (devolucion), ver DS-19.
//   ligada a una salida (devolucion de obra con descuento / recepcion en obra)
//                                    -> completa la etapa B del traslado de ESA salida (DS-17/DS-19): se re-encola la salida.
//   con OC vinculada a Odoo          -> se VALIDA la recepcion que genero la OC (cantidades reales por linea; parcial = backorder).
//   devolucion de obra SIN descuento -> no se publica: no hay origen verificable (criterio 12.1). Queda explicado.
//   resto (compra/sobrante/otro)     -> recepcion libre proveedor -> almacen (origin SGC-ENT-<id>).
//
// Idempotencia de la recepcion de OC: antes de validar se escribe la marca `SGC-REC:<entrada>` en la nota del picking; si un
// picking YA REALIZADO de la OC lleva esa marca, el reintento no vuelve a sumar (el backorder hereda la nota pero no esta hecho).
import type { LlamadorOdoo } from "./odoo-traslados.ts";
import { crearTraslado, devolverTraslado, buscarPickingPorOrigin, TrasladoError, traducirErrorOdoo, validarTraslado } from "./odoo-traslados.ts";
import { clasificarFallo, exito, type Marcar, omitido, type ResultadoEvento } from "./odoo-evento.ts";

// deno-lint-ignore no-explicit-any
type Any = any;

export interface LineaEntrada { nombre: string; cantidad: number; odooProductId: number | null; odooUomId?: number | null }
export interface DatosEntrada {
  id: string; folio?: string; esPrueba: boolean; pendienteConfirmacion: boolean; rechazada: boolean;
  origenTipo: string | null; ordenCompraId: string | null; ocOdooId: number | null; salidaId: string | null;
  bodegaLocationId: number | null; bodegaWarehouseId: number | null;
  lineas: LineaEntrada[]; pickingIdPrevio: number | null; companyId: number;
}
export interface DepsEntrada {
  c: LlamadorOdoo;
  cargar(id: string): Promise<DatosEntrada | null>;
  marcar: Marcar;
  /** Re-encola la salida ligada (devolucion de obra / recepcion en obra) para que complete su paso B. */
  encolarSalida(salidaId: string): Promise<void>;
}

export const MARCA_REC = (entradaId: string) => `SGC-REC:${entradaId}`;
export const originEntrada = (entradaId: string) => `SGC-ENT-${entradaId}`;
const EPS = 1e-9;

export interface ResultadoRecepcionOc { pickingId: number; nombre: string; parcial: boolean; backorderId: number | null; reutilizado: boolean }

/** Valida la recepcion abierta de la OC con las cantidades REALES por linea. Un reintento no vuelve a sumar. */
export async function recibirOc(
  c: LlamadorOdoo, p: { ocId: number; entradaId: string; lineas: Array<{ productId: number; cantidad: number; nombre?: string }> },
): Promise<ResultadoRecepcionOc> {
  try {
    const marca = MARCA_REC(p.entradaId);
    const [oc] = await c.call("purchase.order", "search_read", [[["id", "=", p.ocId]]], { fields: ["name", "state", "picking_ids"], limit: 1 }) ?? [];
    if (!oc) throw new TrasladoError("datos", "La orden de compra no existe en Odoo.");
    if (oc.state === "cancel") throw new TrasladoError("estado_invalido", "La orden de compra está cancelada en Odoo; no se puede recibir.");
    if (oc.state === "draft" || oc.state === "sent" || oc.state === "to approve") {
      throw new TrasladoError("estado_invalido", "La orden de compra aún no está confirmada en Odoo (no tiene recepción). Confírmala primero.", `state=${oc.state}`);
    }
    const ids: number[] = oc.picking_ids ?? [];
    if (!ids.length) throw new TrasladoError("estado_invalido", "La orden confirmada no tiene recepción en Odoo.");
    const picks: Any[] = await c.call("stock.picking", "search_read", [[["id", "in", ids]]], { fields: ["name", "state", "note", "move_ids", "backorder_id"], order: "id asc" });

    // Reintento: ya hay una recepcion REALIZADA con la marca de esta entrada -> no se suma otra vez.
    const hecho = picks.find((k) => k.state === "done" && typeof k.note === "string" && k.note.includes(marca));
    if (hecho) {
      const bo = picks.find((k) => k.backorder_id && k.backorder_id[0] === hecho.id && k.state !== "cancel");
      return { pickingId: hecho.id, nombre: hecho.name, parcial: !!bo, backorderId: bo?.id ?? null, reutilizado: true };
    }
    const abierto = picks.find((k) => k.state !== "done" && k.state !== "cancel");
    if (!abierto) throw new TrasladoError("estado_invalido", "La orden ya fue recibida por completo en Odoo; no queda nada pendiente de recibir.");

    const moves: Any[] = await c.call("stock.move", "read", [abierto.move_ids], { fields: ["product_id", "product_uom_qty", "quantity", "state"] });
    const pedido = new Map<number, number>();
    for (const l of p.lineas) {
      if (!(l.cantidad > 0) || !Number.isFinite(l.cantidad)) continue; // lo no recibido no se publica (queda pendiente en el backorder)
      pedido.set(l.productId, (pedido.get(l.productId) ?? 0) + l.cantidad);
    }
    if (!pedido.size) throw new TrasladoError("datos", "La entrada no tiene cantidades recibidas.");
    for (const pid of pedido.keys()) {
      if (!moves.some((m) => m.product_id[0] === pid)) throw new TrasladoError("datos", "Un artículo recibido no pertenece a esta orden de compra.", `product=${pid}`);
    }
    // Reparto por movimiento (si el producto esta en 2 lineas de la OC se llena en orden). Nunca mas que lo pedido.
    const asignado = new Map<number, number>();
    let completo = true;
    for (const m of moves) {
      if (m.state === "done" || m.state === "cancel") continue;
      const resta = pedido.get(m.product_id[0]) ?? 0;
      const q = Math.min(resta, m.product_uom_qty);
      asignado.set(m.id, q);
      pedido.set(m.product_id[0], resta - q);
      if (q + EPS < m.product_uom_qty) completo = false;
    }
    for (const [pid, resta] of pedido) {
      if (resta > EPS) throw new TrasladoError("datos", "Se recibió más de lo pedido en la orden de compra. Corrige la cantidad o ajusta la orden.", `product=${pid} exceso=${resta}`);
    }

    // Marca de idempotencia ANTES de validar (si el proceso muere despues de validar, el reintento la encuentra).
    await c.call("stock.picking", "write", [[abierto.id], { note: `${typeof abierto.note === "string" ? abierto.note : ""}<p>${marca}</p>` }]);
    if (abierto.state !== "assigned") await c.call("stock.picking", "action_assign", [[abierto.id]]);
    for (const [mid, q] of asignado) await c.call("stock.move", "write", [[mid], { quantity: q }]);
    const r = await c.call("stock.picking", "button_validate", [[abierto.id]], completo ? {} : { context: { skip_backorder: true, picking_ids_not_to_backorder: [] } });
    if (r && typeof r === "object" && !Array.isArray(r) && r.res_model) {
      throw new TrasladoError("parcial_no_permitido", "Odoo pide un paso extra para validar la recepción. Revisa las cantidades en Odoo.", String(r.res_model));
    }
    const [despues] = await c.call("stock.picking", "read", [[abierto.id]], { fields: ["name", "state"] });
    if (despues?.state !== "done") throw new TrasladoError("estado_invalido", "Odoo no dejó la recepción validada.", `state=${despues?.state}`);
    const bo: Any[] = completo ? [] : await c.call("stock.picking", "search_read", [[["backorder_id", "=", abierto.id]]], { fields: ["name", "state"], limit: 1 });
    return { pickingId: abierto.id, nombre: despues.name, parcial: !completo, backorderId: bo[0]?.id ?? null, reutilizado: false };
  } catch (err) {
    throw traducirErrorOdoo(err);
  }
}

export async function publicarEntrada(d: DepsEntrada, entradaId: string, intentos: number): Promise<ResultadoEvento> {
  const e = await d.cargar(entradaId);
  if (!e) return { estado: "error", error: "La entrada ya no existe en SGC." };
  const id = e.id;
  let picking: number | undefined;
  try {
    if (e.esPrueba) {
      // DS-19: real -> prueba despues de publicar. El efecto ERP no puede quedar activo mientras SGC lo revierte: se compensa.
      if (e.pickingIdPrevio) {
        const p = await d.c.call("stock.picking", "read", [[e.pickingIdPrevio]], { fields: ["state"] });
        if (p?.[0]?.state === "done") {
          if (e.ocOdooId) throw new TrasladoError("estado_invalido", "Esta recepción ya validó una orden de compra en Odoo; marcarla como prueba requiere que Compras la revierta allá. No se cambió nada.");
          if (e.bodegaLocationId == null) throw new TrasladoError("datos", "El almacén no está vinculado con Odoo.");
          await devolverTraslado(d.c, e.pickingIdPrevio, { salidaId: id, paso: "A", companyId: e.companyId });
        }
        return await omitido(d.marcar, id, "es_prueba_compensado", "Marcada como prueba: se compensó el movimiento en Odoo.", "sincronizado");
      }
      return { estado: "completado", resultado: { omitido: "es_prueba" } };
    }
    if (e.pendienteConfirmacion) return await omitido(d.marcar, id, "pendiente_confirmacion", "Esperando la confirmación física de la recepción; todavía no se aplica en Odoo.");
    if (e.rechazada) return await omitido(d.marcar, id, "rechazada", "Recepción rechazada: no se aplica nada en Odoo.", "sincronizado");

    // Ligada a una salida: completa B de ESA salida (no es una recepcion de proveedor) -- DS-17/DS-19
    if (e.salidaId) {
      await d.encolarSalida(e.salidaId);
      return await exito(d.marcar, id, undefined, { via: "salida", salida_id: e.salidaId }, "Se aplica con el traslado del conduce de origen.");
    }
    if (e.origenTipo === "devolucion_obra" || e.origenTipo === "recepcion_obra") {
      return await omitido(d.marcar, id, "sin_origen",
        "Devolución sin descontar del almacén de la obra: no hay origen verificable, por eso no se publica en Odoo. Registra un ajuste aprobado si corresponde.");
    }
    if (e.lineas.some((l) => !l.odooProductId)) {
      const sin = e.lineas.filter((l) => !l.odooProductId).map((l) => l.nombre).slice(0, 3).join(", ");
      throw new TrasladoError("datos", `Hay artículos sin vincular con Odoo (${sin}). Vincúlalos en «Productos por dar de alta» y reintenta.`);
    }

    if (e.ordenCompraId) {
      if (!e.ocOdooId) throw new TrasladoError("datos", "La orden de compra de esta entrada no está publicada en Odoo. Publícala y confírmala antes de recibir.");
      const r = await recibirOc(d.c, { ocId: e.ocOdooId, entradaId: id, lineas: e.lineas.map((l) => ({ productId: l.odooProductId!, cantidad: l.cantidad, nombre: l.nombre })) });
      picking = r.pickingId;
      return await exito(d.marcar, id, picking, { picking: r.pickingId, nombre: r.nombre, parcial: r.parcial, backorder: r.backorderId, reutilizado: r.reutilizado },
        r.parcial ? "Recepción parcial: el resto sigue pendiente en la orden de compra." : undefined);
    }

    // Recepcion libre (sin OC): proveedor -> almacen
    if (e.bodegaLocationId == null || e.bodegaWarehouseId == null) throw new TrasladoError("datos", "El almacén de la entrada no está vinculado con Odoo.");
    const origin = originEntrada(id);
    const previo = await buscarPickingPorOrigin(d.c, origin);
    if (previo?.state === "done") { picking = previo.id; return await exito(d.marcar, id, picking, { picking: previo.id, reutilizado: true }); }
    const [wh] = await d.c.call("stock.warehouse", "search_read", [[["id", "=", e.bodegaWarehouseId]]], { fields: ["in_type_id"], limit: 1 });
    const tipoIn = wh?.in_type_id?.[0];
    if (!tipoIn) throw new TrasladoError("datos", "El almacén no tiene tipo de operación de recepción en Odoo.");
    const [prov] = await d.c.call("stock.location", "search_read", [[["usage", "=", "supplier"], ["active", "=", true]]], { fields: ["id"], limit: 1 });
    if (!prov) throw new TrasladoError("datos", "Odoo no tiene ubicación de proveedores.");
    const cr = await crearTraslado(d.c, {
      salidaId: id, paso: "A", origin, origenLocationId: prov.id, destinoLocationId: e.bodegaLocationId, pickingTypeId: tipoIn, companyId: e.companyId, folio: e.folio,
      items: e.lineas.map((l) => ({ productId: l.odooProductId!, cantidad: l.cantidad, uomId: l.odooUomId ?? undefined, nombre: l.nombre })),
    });
    picking = cr.pickingId;
    await validarTraslado(d.c, cr.pickingId);
    return await exito(d.marcar, id, picking, { picking: cr.pickingId, libre: true });
  } catch (err) {
    return await clasificarFallo(err, id, intentos, d.marcar, picking);
  }
}
