// _shared/odoo-traslados.ts -- DS-08/DS-10: traslados de inventario SGC -> Odoo 17 con transito en dos pasos (ADR 4, 12-14, 21).
// RECONSTRUIDO desde docs/PLAN-TRASLADOS-ODOO.md: el codigo original de Miranda nunca llego al repo (ver docs/ODOO-INTEGRACION-AVANCE.md).
//
//   Paso A (despacho):  origen  -> transito   picking interno  origin = SGC-TRAS-<salida>-A
//   Paso B (llegada):   transito -> destino   picking interno  origin = SGC-TRAS-<salida>-B
//
// Reglas: (1) idempotencia por `origin` (reintentar no duplica); (2) Odoo 17 sin asistente inmediato: se fija `quantity`
// en cada movimiento y se llama button_validate; (3) un backorder (parcial) se RECHAZA, no se acepta solo; (4) el chatter va en TEXTO
// PLANO (Odoo escapa el HTML) con el autor resuelto (usuario interno -> empleado -> cuenta tecnica) y siempre «via SGC»;
// (5) errores de Odoo traducidos a mensajes por rol (BS2); nada de trazas al usuario.
import { OdooError } from "./odoo-client.ts";

// deno-lint-ignore no-explicit-any
type Any = any;
/** Lo unico que la biblioteca necesita de OdooClient (inyectable en tests). */
export interface LlamadorOdoo {
  call(model: string, method: string, args?: Any[], kwargs?: Record<string, Any>): Promise<Any>;
}

export type PasoTraslado = "A" | "B";
export const PREFIJO_ORIGIN = "SGC-TRAS-";
export const originTraslado = (salidaId: string, paso: PasoTraslado) => `${PREFIJO_ORIGIN}${salidaId}-${paso}`;

export interface ItemTraslado { productId: number; cantidad: number; uomId?: number; nombre?: string }
export interface EntradaTraslado {
  salidaId: string;
  paso: PasoTraslado;
  origenLocationId: number;
  destinoLocationId: number;
  pickingTypeId: number;
  companyId: number;
  items: ItemTraslado[];
  /** Referencia visible (folio del conduce). */
  folio?: string;
  /** Solo devoluciones: origin propio (…-D1) para que la idempotencia no choque con el picking original. */
  origin?: string;
}
export interface ResultadoTraslado { pickingId: number; nombre: string; estado: string; reutilizado: boolean }

/** Error de negocio con mensaje ya apto para el usuario (BS2) y causa tecnica aparte. */
export class TrasladoError extends Error {
  constructor(public codigo: "sin_stock" | "parcial_no_permitido" | "estado_invalido" | "datos" | "odoo", mensaje: string, public causa?: string) {
    super(mensaje);
    this.name = "TrasladoError";
  }
}

const RX_SIN_STOCK = /not enough|insufficient|negative|no hay suficiente|cantidad negativa|stock disponible/i;

/** Traduce un fallo de Odoo a algo que el usuario entiende; el detalle va en `causa` (solo el log del servidor/desarrollador). */
export function traducirErrorOdoo(e: unknown): TrasladoError {
  if (e instanceof TrasladoError) return e;
  const msg = e instanceof Error ? e.message : String(e);
  if (e instanceof OdooError && !e.fault) throw e; // transporte (timeout/caida): el llamador decide (incierto/reintento)
  if (RX_SIN_STOCK.test(msg)) return new TrasladoError("sin_stock", "No hay existencias suficientes en el almacén de origen para este despacho.", msg);
  return new TrasladoError("odoo", "Odoo rechazó el movimiento de inventario. Tecnología recibió el detalle.", msg);
}

// ── Autor del chatter (ODOO-CHATTER-AUTOR) ─────────────────────────────────
export interface AutorOdoo { partnerId: number; via: "usuario_interno" | "empleado" | "cuenta_tecnica"; nombre?: string; sinCorreo?: boolean }

/** Usuario interno por correo/login -> empleado por cedula -> cuenta tecnica. `tecnicoPartnerId` = partner de la clave de integracion. */
export async function resolverAutorOdoo(
  c: LlamadorOdoo,
  datos: { correo?: string | null; cedula?: string | null; tecnicoPartnerId: number },
): Promise<AutorOdoo> {
  const correo = datos.correo?.trim().toLowerCase();
  if (correo) {
    const us = await c.call("res.users", "search_read", [[["login", "=ilike", correo], ["share", "=", false]]], { fields: ["partner_id"], limit: 2 });
    if (Array.isArray(us) && us.length === 1 && us[0].partner_id) return { partnerId: us[0].partner_id[0], via: "usuario_interno", nombre: us[0].partner_id[1] };
  }
  const ced = datos.cedula?.replace(/\D/g, "");
  if (ced) {
    const emp = await c.call("hr.employee", "search_read", [[["identification_id", "ilike", ced]]], { fields: ["work_contact_id", "user_id", "name"], limit: 2 });
    if (Array.isArray(emp) && emp.length === 1 && emp[0].work_contact_id) return { partnerId: emp[0].work_contact_id[0], via: "empleado", nombre: emp[0].name };
  }
  return { partnerId: datos.tecnicoPartnerId, via: "cuenta_tecnica" };
}

/** Texto plano (sin HTML) con la firma «via SGC». Odoo escapa el HTML en el chatter, asi que nunca se envian etiquetas. */
export function textoChatter(texto: string, autor?: { nombre?: string | null }): string {
  const limpio = texto.replace(/<[^>]*>/g, "").replace(/[ \t]+\n/g, "\n").trim();
  return `${limpio}\n— vía SGC${autor?.nombre ? ` (${autor.nombre})` : ""}`;
}

export async function publicarNotaPicking(
  c: LlamadorOdoo, pickingId: number, texto: string, autor?: AutorOdoo, emailFallback = "sgc@localhost",
): Promise<void> {
  const kwargs: Record<string, Any> = { body: textoChatter(texto, autor), message_type: "comment", subtype_xmlid: "mail.mt_note" };
  if (autor) {
    kwargs.author_id = autor.partnerId;
    if (autor.sinCorreo) kwargs.email_from = emailFallback; // un contacto sin correo no puede ser autor sin email_from
  }
  await c.call("stock.picking", "message_post", [[pickingId]], kwargs);
}

// ── Crear (idempotente) ────────────────────────────────────────────────────
function validarEntrada(e: EntradaTraslado): void {
  if (!e.salidaId) throw new TrasladoError("datos", "Falta el identificador del conduce.");
  if (!Number.isSafeInteger(e.origenLocationId) || !Number.isSafeInteger(e.destinoLocationId) || e.origenLocationId === e.destinoLocationId) {
    throw new TrasladoError("datos", "Origen y destino del traslado deben ser ubicaciones distintas y válidas.");
  }
  if (!e.items.length) throw new TrasladoError("datos", "El traslado no tiene artículos.");
  for (const it of e.items) {
    if (!Number.isSafeInteger(it.productId) || it.productId <= 0) throw new TrasladoError("datos", `Un artículo (${it.nombre ?? "?"}) no está homologado con Odoo.`);
    if (!(it.cantidad > 0) || !Number.isFinite(it.cantidad)) throw new TrasladoError("datos", "Todas las cantidades deben ser mayores que cero.");
  }
}

export async function buscarPickingPorOrigin(c: LlamadorOdoo, origin: string): Promise<{ id: number; name: string; state: string } | null> {
  const r = await c.call("stock.picking", "search_read", [[["origin", "=", origin]]], { fields: ["name", "state"], limit: 2, order: "id asc" });
  return Array.isArray(r) && r.length ? { id: r[0].id, name: r[0].name, state: r[0].state } : null;
}

/** Crea el picking (borrador) o devuelve el que ya existe con el mismo `origin`. NO valida. */
export async function crearTraslado(c: LlamadorOdoo, e: EntradaTraslado): Promise<ResultadoTraslado> {
  validarEntrada(e);
  const origin = e.origin ?? originTraslado(e.salidaId, e.paso);
  const previo = await buscarPickingPorOrigin(c, origin);
  if (previo) return { pickingId: previo.id, nombre: previo.name, estado: previo.state, reutilizado: true };
  try {
    const id = await c.call("stock.picking", "create", [{
      picking_type_id: e.pickingTypeId,
      location_id: e.origenLocationId,
      location_dest_id: e.destinoLocationId,
      company_id: e.companyId,
      origin,
      note: e.folio ? `Conduce ${e.folio}` : undefined,
      move_ids_without_package: e.items.map((it) => [0, 0, {
        name: it.nombre ?? `SGC ${e.folio ?? e.salidaId}`,
        product_id: it.productId,
        product_uom_qty: it.cantidad,
        ...(it.uomId ? { product_uom: it.uomId } : {}),
        location_id: e.origenLocationId,
        location_dest_id: e.destinoLocationId,
        company_id: e.companyId,
      }]),
    }]);
    const [p] = await c.call("stock.picking", "read", [[id]], { fields: ["name", "state"] });
    return { pickingId: id, nombre: p.name, estado: p.state, reutilizado: false };
  } catch (err) {
    throw traducirErrorOdoo(err);
  }
}

// ── Validar (Odoo 17: sin stock.immediate.transfer) ────────────────────────
/** Confirma, reserva, fija `quantity` = demanda por movimiento y valida. Un backorder se rechaza. Idempotente si ya esta `done`. */
export async function validarTraslado(c: LlamadorOdoo, pickingId: number): Promise<ResultadoTraslado> {
  try {
    let [p] = await c.call("stock.picking", "read", [[pickingId]], { fields: ["name", "state", "move_ids", "location_id"] });
    if (!p) throw new TrasladoError("estado_invalido", "El movimiento no existe en Odoo.");
    if (p.state === "done") return { pickingId, nombre: p.name, estado: "done", reutilizado: true };
    if (p.state === "cancel") throw new TrasladoError("estado_invalido", "El movimiento está cancelado en Odoo; no se puede validar.");
    await exigirStockSiEsInterna(c, p.location_id[0], p.move_ids);
    if (p.state === "draft") await c.call("stock.picking", "action_confirm", [[pickingId]]);
    await c.call("stock.picking", "action_assign", [[pickingId]]);
    const moves = await c.call("stock.move", "read", [p.move_ids], { fields: ["product_uom_qty", "state"] });
    // Odoo 17: `quantity` del movimiento es la cantidad hecha. La fijamos a la demanda (traslado completo).
    for (const m of moves) if (m.state !== "done" && m.state !== "cancel") await c.call("stock.move", "write", [[m.id], { quantity: m.product_uom_qty }]);
    const r = await c.call("stock.picking", "button_validate", [[pickingId]]);
    if (r && typeof r === "object" && !Array.isArray(r) && r.res_model) {
      // Asistente de backorder / de otro tipo: este flujo nunca acepta un parcial por su cuenta.
      throw new TrasladoError("parcial_no_permitido", "Odoo pide confirmar una entrega parcial; el traslado debe ser completo. Revisa las cantidades.", String(r.res_model));
    }
    [p] = await c.call("stock.picking", "read", [[pickingId]], { fields: ["name", "state"] });
    if (p.state !== "done") throw new TrasladoError("estado_invalido", "Odoo no dejó el movimiento validado.", `state=${p.state}`);
    return { pickingId, nombre: p.name, estado: "done", reutilizado: false };
  } catch (err) {
    throw traducirErrorOdoo(err);
  }
}

/** Si el origen es una ubicacion interna, exige stock (Odoo no lo hace). Desde transito/virtual no aplica. */
async function exigirStockSiEsInterna(c: LlamadorOdoo, locationId: number, moveIds: number[]): Promise<void> {
  const [loc] = await c.call("stock.location", "search_read", [[["id", "=", locationId]]], { fields: ["usage"] });
  if (loc?.usage !== "internal") return;
  const moves = await c.call("stock.move", "read", [moveIds], { fields: ["product_id", "product_uom_qty"] });
  const falta = await faltantesDeStock(c, locationId, moves.map((m: Any) => ({ productId: m.product_id[0], cantidad: m.product_uom_qty })));
  if (falta.length) {
    const ids = [...new Set(falta.map((f) => f.productId))];
    const prods: Any[] = await c.call("product.product", "search_read", [[["id", "in", ids]]], { fields: ["display_name"], limit: ids.length });
    const nombres = new Map<number, string>((prods ?? []).map((x: Any) => [x.id, String(x.display_name ?? "")]));
    const r6 = (n: number) => Math.round(n * 1e6) / 1e6;
    const trim = (n: number) => r6(n).toFixed(6).replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
    const lineas = falta.map((f) => `${nombres.get(f.productId) || "producto " + f.productId}: solicitado ${trim(f.pedido)}, disponible ${trim(f.disponible)}`);
    throw new TrasladoError("sin_stock", `No hay existencias suficientes en el almacén de origen. ${lineas.join("; ")}.`, JSON.stringify(falta));
  }
}

export async function cancelarTraslado(c: LlamadorOdoo, pickingId: number): Promise<{ estado: string }> {
  try {
    const [p] = await c.call("stock.picking", "read", [[pickingId]], { fields: ["state"] });
    if (!p) throw new TrasladoError("estado_invalido", "El movimiento no existe en Odoo.");
    if (p.state === "cancel") return { estado: "cancel" };
    if (p.state === "done") throw new TrasladoError("estado_invalido", "El movimiento ya está validado en Odoo: hay que devolverlo, no cancelarlo.");
    await c.call("stock.picking", "action_cancel", [[pickingId]]);
    return { estado: "cancel" };
  } catch (err) {
    throw traducirErrorOdoo(err);
  }
}

/** Devolucion = traslado inverso (destino -> origen) del picking ya validado, con su propio `origin` -D<n>. */
export async function devolverTraslado(
  c: LlamadorOdoo, pickingId: number, opts: { salidaId: string; paso: PasoTraslado; secuencia?: number; items?: ItemTraslado[]; companyId: number; origin?: string },
): Promise<ResultadoTraslado> {
  try {
    const [p] = await c.call("stock.picking", "read", [[pickingId]], { fields: ["state", "location_id", "location_dest_id", "picking_type_id", "move_ids"] });
    if (!p || p.state !== "done") throw new TrasladoError("estado_invalido", "Solo se puede devolver un movimiento ya validado.");
    const origin = opts.origin ?? `${originTraslado(opts.salidaId, opts.paso)}-D${opts.secuencia ?? 1}`;
    const previo = await buscarPickingPorOrigin(c, origin);
    if (previo) return { pickingId: previo.id, nombre: previo.name, estado: previo.state, reutilizado: true };
    let items = opts.items;
    if (!items) {
      const moves = await c.call("stock.move", "read", [p.move_ids], { fields: ["product_id", "quantity", "product_uom"] });
      items = moves.map((m: Any) => ({ productId: m.product_id[0], cantidad: m.quantity, uomId: m.product_uom[0] }));
    }
    const r = await crearTraslado(c, {
      salidaId: `${opts.salidaId}`, paso: opts.paso, origenLocationId: p.location_dest_id[0], destinoLocationId: p.location_id[0],
      pickingTypeId: p.picking_type_id[0], companyId: opts.companyId, items: items!, origin,
    });
    return validarTraslado(c, r.pickingId);
  } catch (err) {
    throw traducirErrorOdoo(err);
  }
}

/** Lectura de pickings SGC (filtrados por prefijo de origin). */
export async function listarTraslados(c: LlamadorOdoo, filtro: { salidaId?: string; desde?: string; limite?: number } = {}): Promise<Any[]> {
  const dom: Any[] = [["origin", "=like", `${PREFIJO_ORIGIN}${filtro.salidaId ?? ""}%`]];
  if (filtro.desde) dom.push(["write_date", ">=", filtro.desde]);
  return await c.call("stock.picking", "search_read", [dom], { fields: ["name", "state", "origin", "location_id", "location_dest_id", "write_date", "write_uid"], limit: Math.min(filtro.limite ?? 200, 500), order: "write_date desc" });
}

export async function obtenerTraslado(c: LlamadorOdoo, pickingId: number): Promise<Any | null> {
  const r = await c.call("stock.picking", "read", [[pickingId]], { fields: ["name", "state", "origin", "location_id", "location_dest_id", "move_ids", "write_date"] });
  return Array.isArray(r) && r.length ? r[0] : null;
}

// ── Disponibilidad (ADR 3) ─────────────────────────────────────────────────
// Odoo 17 de CSD PERMITE stock negativo (medido en staging: validó un traslado de 9.999.999 sin quejarse), asi que la
// proteccion es de SGC: se consulta lo disponible (cantidad - reservado) en la ubicacion de origen antes de validar.
export interface FaltanteStock { productId: number; pedido: number; disponible: number }

export async function disponibilidadPorProducto(c: LlamadorOdoo, locationId: number, productIds: number[]): Promise<Map<number, number>> {
  const filas = await c.call("stock.quant", "read_group", [[["location_id", "child_of", locationId], ["product_id", "in", productIds]], ["quantity:sum", "reserved_quantity:sum"], ["product_id"]], { lazy: false });
  const m = new Map<number, number>();
  for (const f of filas ?? []) m.set(f.product_id[0], Number(f.quantity ?? 0) - Number(f.reserved_quantity ?? 0));
  return m;
}

/** Devuelve los articulos cuya cantidad pedida supera lo disponible en la ubicacion de origen. Vacio = hay stock. */
export async function faltantesDeStock(c: LlamadorOdoo, locationId: number, items: Array<{ productId: number; cantidad: number }>): Promise<FaltanteStock[]> {
  const disp = await disponibilidadPorProducto(c, locationId, items.map((i) => i.productId));
  const pedido = new Map<number, number>();
  for (const i of items) pedido.set(i.productId, (pedido.get(i.productId) ?? 0) + i.cantidad);
  return [...pedido].filter(([id, q]) => q > (disp.get(id) ?? 0) + 1e-9).map(([id, q]) => ({ productId: id, pedido: q, disponible: disp.get(id) ?? 0 }));
}
