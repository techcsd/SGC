// _shared/odoo-faltantes.ts -- DS-17/DS-28 (ADR 5): ejecuta en Odoo la decision sobre un FALTANTE en transito.
// Un conduce entregado incompleto deja la diferencia (enviado - recibido) en la ubicacion de transito de Odoo. Un jefe de inventario
// decide en SGC (`odoo_ajuste_decidir`) y el worker ejecuta aqui:
//   aprobar  (accion `ajuste`)            -> BAJA del faltante desde transito con la accion de negocio de inventario (`SGC-TRAS-<salida>-F<id>`)
//   rechazar (accion `devolver_transito`) -> traslado transito -> origen del faltante (picking `SGC-TRAS-<salida>-F<id>`), validado
// Todo idempotente por nombre/origin. Pura sobre dependencias inyectadas (se prueba sin Odoo ni BD). APAGADO: solo corre con la
// politica `ajuste_faltante` habilitada y la instancia con entrada+salida permitidas.
import { TrasladoError, traducirErrorOdoo, type LlamadorOdoo } from "./odoo-traslados.ts";
import { ajustarArticulo } from "./odoo-ajustes.ts";
import { clasificarFallo, exito, type Marcar, omitido, type ResultadoEvento } from "./odoo-evento.ts";
import type { Biblioteca } from "./odoo-salidas.ts";

const EPS = 1e-6;
export const refFaltante = (salidaId: string, solicitudId: string) => `SGC-TRAS-${salidaId}-F${solicitudId.slice(0, 8)}`;

export interface DatosAjusteFaltante {
  id: string; salidaId: string; folio?: string; estado: "pendiente" | "aprobada" | "rechazada" | string; accion: "ajuste" | "devolver_transito" | string | null;
  esPrueba: boolean; faltante: number; articuloNombre: string; odooProductId: number | null;
  origenLocationId: number | null; origenWarehouseId: number | null; companyId: number;
}
export interface DepsAjusteFaltante {
  c: LlamadorOdoo;
  lib: Pick<Biblioteca, "buscar" | "crear" | "validar" | "transitoLocationId" | "tipoInterno" | "publicado">;
  cargar(id: string): Promise<DatosAjusteFaltante | null>;
  marcar: Marcar;
}

async function saldoTransito(c: LlamadorOdoo, transito: number, productId: number): Promise<number> {
  const q = await c.call("stock.quant", "search_read", [[["location_id", "=", transito], ["product_id", "=", productId]]], { fields: ["quantity"] });
  return (q ?? []).reduce((s: number, x: { quantity: number }) => s + Number(x.quantity ?? 0), 0);
}

export async function publicarAjusteFaltante(d: DepsAjusteFaltante, id: string, intentos: number): Promise<ResultadoEvento> {
  const a = await d.cargar(id);
  if (!a) return { estado: "error", error: "La solicitud de ajuste ya no existe en SGC." };
  try {
    if (a.esPrueba) return { estado: "completado", resultado: { omitido: "es_prueba" } };
    if (a.estado === "pendiente" || !a.accion) return await omitido(d.marcar, id, "sin_decision", "El faltante espera la decisión del jefe de inventario.", null);
    if (!a.odooProductId) throw new TrasladoError("datos", `El artículo «${a.articuloNombre}» no está vinculado con Odoo. Vincúlalo y reintenta.`);
    if (a.origenLocationId == null || a.origenWarehouseId == null) throw new TrasladoError("datos", "El almacén de origen no está vinculado con Odoo.");
    if (!(a.faltante > 0)) throw new TrasladoError("datos", "El faltante no es válido.");

    const A = await d.lib.buscar(`SGC-TRAS-${a.salidaId}-A`);
    if (!A || A.state !== "done") throw new TrasladoError("estado_invalido", "El despacho de este conduce aún no está validado en Odoo: no hay material en tránsito que resolver.");
    const transito = await d.lib.transitoLocationId();
    const ref = refFaltante(a.salidaId, a.id);

    if (a.accion === "devolver_transito") {
      const previo = await d.lib.buscar(ref);
      if (!previo) await verificarEnTransito(d, a);
      const p = previo ? { pickingId: previo.id } : await d.lib.crear({
        salidaId: a.salidaId, paso: "B", origin: ref, origenLocationId: transito, destinoLocationId: a.origenLocationId, pickingTypeId: await d.lib.tipoInterno(a.origenWarehouseId),
        companyId: a.companyId, items: [{ productId: a.odooProductId, cantidad: a.faltante, nombre: a.articuloNombre }], folio: a.folio,
      });
      if (!previo || previo.state !== "done") await d.lib.validar(p.pickingId);
      return await exito(d.marcar, id, p.pickingId, { devuelto_a_origen: true, picking: p.pickingId, faltante: a.faltante }, "Faltante devuelto de tránsito al almacén de origen en Odoo.");
    }

    // aprobar: baja desde transito (inventario de Odoo, objetivo absoluto = saldo actual - faltante; idempotente por nombre)
    const nombre = `${ref}-AJ`;
    const hecho = await d.c.call("stock.move", "search_read", [[["name", "=", nombre], ["product_id", "=", a.odooProductId], ["state", "=", "done"]]], { fields: ["quantity"], limit: 1 });
    if (!(hecho ?? []).length) await verificarEnTransito(d, a);
    const saldo = await saldoTransito(d.c, transito, a.odooProductId);
    const objetivo = (hecho ?? []).length ? saldo : saldo - a.faltante;
    if (objetivo < -EPS) throw new TrasladoError("sin_stock", "No hay suficiente material en tránsito en Odoo para darlo de baja.", `transito=${saldo} faltante=${a.faltante}`);
    let r;
    try { r = await ajustarArticulo(d.c, { nombre, locationId: transito, productId: a.odooProductId, objetivo: Math.max(0, objetivo) }); } catch (e) { throw traducirErrorOdoo(e); }
    return await exito(d.marcar, id, undefined, { baja_en_transito: true, linea: r, faltante: a.faltante }, "Ajuste aprobado: el faltante se dio de baja desde tránsito en Odoo.");
  } catch (err) {
    return await clasificarFallo(err, id, intentos, d.marcar);
  }
}

/** El faltante no puede superar lo que ese conduce dejo en transito (A publicado - B - otros faltantes ya resueltos). */
async function verificarEnTransito(d: DepsAjusteFaltante, a: DatosAjusteFaltante): Promise<void> {
  if (!d.lib.publicado) return;
  const pid = a.odooProductId!;
  const [pa, pb, pf] = await Promise.all([d.lib.publicado(`SGC-TRAS-${a.salidaId}-A`), d.lib.publicado(`SGC-TRAS-${a.salidaId}-B`), d.lib.publicado(`SGC-TRAS-${a.salidaId}-F`)]);
  const enTransito = (pa.get(pid) ?? 0) - (pb.get(pid) ?? 0) - (pf.get(pid) ?? 0);
  if (a.faltante > enTransito + EPS) {
    throw new TrasladoError("datos", "El faltante es mayor que lo que ese conduce dejó en tránsito en Odoo. Revisa las cantidades antes de resolverlo.", `enTransito=${enTransito} faltante=${a.faltante}`);
  }
}
