// _shared/odoo-retiros.ts -- DS-21 (#14): retiro de material danado, cuarentena y disposicion -> Odoo.
//
// Como funciona hoy en SGC (verificado en sql/2026-09-01-bg4-retiro-material-rpcs.sql, no en la doc historica):
//   * solicitar / aprobar / rechazar / cancelar  -> solo papel: NO hay hecho fisico, nada se publica (criterio 1).
//   * conduce externo del retiro                 -> documento de TRANSPORTE sin bodegas (no afecta inventario): nunca duplica el movimiento (criterio 4).
//   * retiro_recibir                             -> entra a CUARENTENA del almacen destino (ledger propio `adjust_cuarentena`); NO descuenta el origen.
//   * retiro_disponer                            -> descarte | devolucion (a proveedor) | reparacion (vuelve a stock disponible).
//
// Mapa en Odoo (todo con picking interno, origin propio e idempotente):
//   recibido                   obra (almacen de la obra)  ->  ubicacion de CUARENTENA del almacen destino   origin SGC-RET-<id>-IN
//   descarte                   cuarentena                 ->  ubicacion de desecho (scrap)                  origin SGC-RET-<id>-DISP
//   devolucion a proveedor     cuarentena                 ->  ubicacion de proveedores                      origin SGC-RET-<id>-DISP
//   reparacion                 cuarentena                 ->  stock disponible del almacen destino          origin SGC-RET-<id>-DISP
// La ubicacion de cuarentena es NO DESPACHABLE por definicion (hija de nada que cuente como stock disponible de WH): la crea Contabilidad/
// Inventario en Odoo y se enlaza en `bodegas.odoo_cuarentena_location_id` (paso fisico, ver docs/ODOO-CIRCUITO2.md). Sin ella el retiro
// queda «pendiente» con el motivo exacto: nunca se manda material danado al stock disponible. «Reparacion» no implica el modulo Repair.
// Contrapartida de origen: la obra debe TENER esas existencias en Odoo (Odoo de CSD permite negativos, por eso se verifica); si no, no se
// inventa material nuevo: el retiro queda en error explicado hasta que se corrija el origen.
import type { LlamadorOdoo } from "./odoo-traslados.ts";
import { crearTraslado, TrasladoError, validarTraslado, buscarPickingPorOrigin } from "./odoo-traslados.ts";
import { clasificarFallo, exito, type Marcar, omitido, type ResultadoEvento } from "./odoo-evento.ts";

export const originRetiro = (id: string, fase: "IN" | "DISP") => `SGC-RET-${id}-${fase}`;

export interface ItemRetiro { nombre: string; cantidad: number; odooProductId: number | null; odooUomId?: number | null }
export interface DatosRetiro {
  id: string; folio?: string; estado: string; esPrueba: boolean; disposicion: string | null;
  items: ItemRetiro[];
  obraLocationId: number | null;            // ubicacion del almacen de la OBRA (origen real del material)
  destinoWarehouseId: number | null;
  destinoStockLocationId: number | null;    // stock disponible del almacen destino (solo reparacion)
  cuarentenaLocationId: number | null;      // ubicacion no despachable (paso fisico en Odoo)
  companyId: number;
}
export interface DepsRetiro { c: LlamadorOdoo; cargar(id: string): Promise<DatosRetiro | null>; marcar: Marcar }

async function tipoInterno(c: LlamadorOdoo, warehouseId: number): Promise<number> {
  const [w] = await c.call("stock.warehouse", "search_read", [[["id", "=", warehouseId]]], { fields: ["int_type_id"], limit: 1 }) ?? [];
  const id = w?.int_type_id?.[0];
  if (!id) throw new TrasladoError("datos", "El almacén destino no tiene tipo de operación interna en Odoo.");
  return id;
}

async function ubicacionEspecial(c: LlamadorOdoo, tipo: "scrap" | "supplier"): Promise<number> {
  const dom = tipo === "scrap" ? [["scrap_location", "=", true], ["usage", "=", "inventory"], ["active", "=", true]] : [["usage", "=", "supplier"], ["active", "=", true]];
  const [l] = await c.call("stock.location", "search_read", [dom], { fields: ["id"], limit: 1, order: "id asc" }) ?? [];
  if (!l) throw new TrasladoError("datos", tipo === "scrap" ? "Odoo no tiene ubicación de desecho." : "Odoo no tiene ubicación de proveedores.");
  return l.id;
}

/** Crea (idempotente por origin) y valida un traslado de retiro. Sin existencias en el origen -> mensaje propio de retiros. */
async function mover(c: LlamadorOdoo, r: DatosRetiro, origin: string, desde: number, hacia: number, tipoId: number): Promise<{ pickingId: number; reutilizado: boolean }> {
  const previo = await buscarPickingPorOrigin(c, origin);
  if (previo?.state === "done") return { pickingId: previo.id, reutilizado: true };
  const cr = await crearTraslado(c, {
    salidaId: r.id, paso: "A", origin, origenLocationId: desde, destinoLocationId: hacia, pickingTypeId: tipoId, companyId: r.companyId, folio: r.folio,
    items: r.items.map((i) => ({ productId: i.odooProductId!, cantidad: i.cantidad, uomId: i.odooUomId ?? undefined, nombre: i.nombre })),
  });
  try {
    await validarTraslado(c, cr.pickingId);
  } catch (e) {
    if (e instanceof TrasladoError && e.codigo === "sin_stock" && origin.endsWith("-IN")) {
      try { await c.call("stock.picking", "action_cancel", [[cr.pickingId]]); } catch { /* best-effort: no dejar borrador huerfano */ }
      throw new TrasladoError("sin_stock", "El almacén de la obra no tiene esas existencias en Odoo: el retiro no puede salir de un origen sin respaldo. Corrige el origen o registra un ajuste aprobado.", e.causa);
    }
    throw e;
  }
  return { pickingId: cr.pickingId, reutilizado: cr.reutilizado };
}

export async function publicarRetiro(d: DepsRetiro, retiroId: string, intentos: number): Promise<ResultadoEvento> {
  const r = await d.cargar(retiroId);
  if (!r) return { estado: "error", error: "El retiro ya no existe en SGC." };
  const id = r.id;
  let picking: number | undefined;
  try {
    if (r.esPrueba) return { estado: "completado", resultado: { omitido: "es_prueba" } };
    // Sin hecho fisico (solicitud/aprobacion/conduce de transporte) no se inventa entrada ni ajuste.
    if (!["en_cuarentena", "dispuesta"].includes(r.estado)) return await omitido(d.marcar, id, "sin_hecho_fisico", "El retiro aún no se ha recibido físicamente: no se publica en Odoo.", null);
    if (r.items.some((i) => !i.odooProductId)) {
      const sin = r.items.filter((i) => !i.odooProductId).map((i) => i.nombre).slice(0, 3).join(", ");
      throw new TrasladoError("datos", `Hay material sin artículo vinculado con Odoo (${sin}). Vincúlalo y reintenta.`);
    }
    if (r.cuarentenaLocationId == null) {
      return await omitido(d.marcar, id, "sin_cuarentena", "El almacén destino no tiene ubicación de cuarentena en Odoo: Inventario debe crearla y enlazarla. El material dañado no se manda al stock disponible.");
    }
    if (r.destinoWarehouseId == null) throw new TrasladoError("datos", "El almacén destino del retiro no está vinculado con Odoo.");
    const tipo = await tipoInterno(d.c, r.destinoWarehouseId);

    // 1) recepcion a cuarentena (siempre primero; idempotente)
    if (r.obraLocationId == null) throw new TrasladoError("datos", "La obra de origen no tiene un almacén vinculado con Odoo: no hay contrapartida de origen para el retiro.");
    const entrada = await mover(d.c, r, originRetiro(id, "IN"), r.obraLocationId, r.cuarentenaLocationId, tipo);
    picking = entrada.pickingId;
    if (r.estado === "en_cuarentena") return await exito(d.marcar, id, picking, { cuarentena: true, picking_in: picking, reutilizado: entrada.reutilizado });

    // 2) disposicion
    let destino: number;
    switch (r.disposicion) {
      case "descarte": destino = await ubicacionEspecial(d.c, "scrap"); break;
      case "devolucion": destino = await ubicacionEspecial(d.c, "supplier"); break;
      case "reparacion":
        if (r.destinoStockLocationId == null) throw new TrasladoError("datos", "El stock disponible del almacén destino no está vinculado con Odoo.");
        destino = r.destinoStockLocationId; break;
      default: throw new TrasladoError("datos", "La disposición del retiro no es válida.");
    }
    const disp = await mover(d.c, r, originRetiro(id, "DISP"), r.cuarentenaLocationId, destino, tipo);
    picking = disp.pickingId;
    return await exito(d.marcar, id, picking, { disposicion: r.disposicion, picking_in: entrada.pickingId, picking_disp: disp.pickingId, reutilizado: disp.reutilizado });
  } catch (err) {
    return await clasificarFallo(err, id, intentos, d.marcar, picking);
  }
}
