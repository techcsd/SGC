// _shared/odoo-salidas.ts -- DS-10/DS-11: publica una salida de inventario (conduce) como traslado con transito A/B en Odoo.
// Lo invoca el worker odoo-sync para eventos `salida_inventario` (el outbox CY6 ya los captura). La logica es pura sobre
// dependencias inyectadas (datos de SGC + biblioteca de traslados) para poder probarla sin Odoo ni BD.
//
// Decision por estado de la salida:
//   despachado                    -> A (origen -> transito)                       [+ B si la parada de ruta ya esta entregada]
//   entregado / entregado_incompleto -> A y B (B con lo RECIBIDO; el faltante queda en transito y se avisa: ADR 5)
//   anulado / rechazada           -> A pendiente: cancelar; A validado: devolver (transito -> origen); B validado: devolver antes
// Todo es idempotente por `origin` (SGC-TRAS-<salida>-A|B): reprocesar nunca duplica.
import { OdooError } from "./odoo-client.ts";
import { type ItemTraslado, type PasoTraslado, TrasladoError } from "./odoo-traslados.ts";

export interface LineaSalida { nombre: string; cantidad: number; cantidadRecibida: number | null; odooProductId: number | null; odooUomId?: number | null }
export interface DatosSalida {
  id: string; folio?: string; estado: string; esPrueba: boolean; paradaEntregada: boolean;
  lineas: LineaSalida[];
  origenLocationId: number | null; origenWarehouseId: number | null;
  destinoLocationId: number | null;
  companyId: number;
}
export interface Biblioteca {
  buscar(origin: string): Promise<{ id: number; state: string } | null>;
  crear(e: { salidaId: string; paso: PasoTraslado; origenLocationId: number; destinoLocationId: number; pickingTypeId: number; companyId: number; items: ItemTraslado[]; folio?: string }): Promise<{ pickingId: number }>;
  validar(pickingId: number): Promise<{ estado: string }>;
  cancelar(pickingId: number): Promise<unknown>;
  devolver(pickingId: number, paso: PasoTraslado, salidaId: string, companyId: number): Promise<unknown>;
  transitoLocationId(): Promise<number>;
  tipoInterno(warehouseId: number): Promise<number>;
}
export interface DepsSalida {
  lib: Biblioteca;
  cargar(salidaId: string): Promise<DatosSalida | null>;
  marcar(salidaId: string, m: { a?: number; b?: number; estado: "pendiente" | "sincronizado" | "incierto" | "error"; error?: string }): Promise<void>;
}
export interface ResultadoEvento { estado: "completado" | "reintento" | "error" | "incierto"; resultado?: Record<string, unknown>; error?: string; reintentarEnMs?: number }

export const MAX_INTENTOS = 8;
const espera = (intentos: number) => Math.min(10 * 60_000, 30_000 * 2 ** Math.max(0, intentos - 1));
const origen = (id: string, p: PasoTraslado) => `SGC-TRAS-${id}-${p}`;

function itemsDe(s: DatosSalida, paso: PasoTraslado): ItemTraslado[] {
  return s.lineas
    .map((l) => ({ productId: l.odooProductId ?? 0, cantidad: paso === "A" ? l.cantidad : (l.cantidadRecibida ?? l.cantidad), uomId: l.odooUomId ?? undefined, nombre: l.nombre }))
    .filter((i) => i.cantidad > 0);
}

export async function publicarSalida(d: DepsSalida, salidaId: string, intentos: number): Promise<ResultadoEvento> {
  const s = await d.cargar(salidaId);
  if (!s) return { estado: "error", error: "La salida ya no existe en SGC." };
  if (s.esPrueba) return { estado: "completado", resultado: { omitido: "es_prueba" } };
  let a: number | undefined; let b: number | undefined;
  try {
    const A = await d.lib.buscar(origen(s.id, "A")); const B = await d.lib.buscar(origen(s.id, "B"));

    if (s.estado === "anulado" || s.estado === "rechazada") {
      // B primero (deshacer en orden inverso), luego A
      for (const [p, pk] of [["B", B], ["A", A]] as const) {
        if (!pk || pk.state === "cancel") continue;
        if (pk.state === "done") await d.lib.devolver(pk.id, p, s.id, s.companyId); else await d.lib.cancelar(pk.id);
      }
      await d.marcar(s.id, { a: A?.id, b: B?.id, estado: "sincronizado" });
      return { estado: "completado", resultado: { revertido: true, picking_a: A?.id ?? null, picking_b: B?.id ?? null } };
    }

    if (s.origenLocationId == null || s.origenWarehouseId == null) throw new TrasladoError("datos", "El almacén de origen no está vinculado con Odoo.");
    if (s.lineas.some((l) => !l.odooProductId)) {
      const sin = s.lineas.filter((l) => !l.odooProductId).map((l) => l.nombre).slice(0, 3).join(", ");
      throw new TrasladoError("datos", `Hay artículos sin vincular con Odoo (${sin}). Vincúlalos en «Productos por dar de alta» y reintenta.`);
    }
    const transito = await d.lib.transitoLocationId();
    const tipo = await d.lib.tipoInterno(s.origenWarehouseId);

    // Paso A
    const itemsA = itemsDe(s, "A");
    if (!itemsA.length) throw new TrasladoError("datos", "El conduce no tiene cantidades a trasladar.");
    const pa = A ? { pickingId: A.id } : await d.lib.crear({ salidaId: s.id, paso: "A", origenLocationId: s.origenLocationId, destinoLocationId: transito, pickingTypeId: tipo, companyId: s.companyId, items: itemsA, folio: s.folio });
    a = pa.pickingId;
    if (!A || A.state !== "done") await d.lib.validar(a);

    // Paso B: parada entregada (ADR 4) o recepcion confirmada
    const quiereB = s.paradaEntregada || s.estado === "entregado" || s.estado === "entregado_incompleto";
    let faltante = false;
    if (quiereB) {
      if (s.destinoLocationId == null) throw new TrasladoError("datos", "El destino del conduce no está vinculado con Odoo; el material queda en tránsito.");
      const itemsB = itemsDe(s, "B");
      faltante = s.lineas.some((l) => (l.cantidadRecibida ?? l.cantidad) < l.cantidad);
      if (itemsB.length) {
        const pb = B ? { pickingId: B.id } : await d.lib.crear({ salidaId: s.id, paso: "B", origenLocationId: transito, destinoLocationId: s.destinoLocationId, pickingTypeId: tipo, companyId: s.companyId, items: itemsB, folio: s.folio });
        b = pb.pickingId;
        if (!B || B.state !== "done") await d.lib.validar(b);
      }
    }
    // Un faltante real se queda en transito: queda visible (AT11) y espera la solicitud de ajuste aprobada (ADR 5).
    await d.marcar(s.id, { a, b, estado: "sincronizado", error: faltante ? "Faltante en tránsito: pendiente de ajuste aprobado." : undefined });
    return { estado: "completado", resultado: { picking_a: a, picking_b: b ?? null, faltante_en_transito: faltante } };
  } catch (e) {
    if (e instanceof OdooError) {
      // Falla de transporte: no se sabe si aplico. Es seguro reintentar (todo es idempotente por origin).
      if (intentos >= MAX_INTENTOS) {
        await d.marcar(s.id, { a, b, estado: "incierto", error: "Odoo no respondió tras varios intentos." });
        return { estado: "incierto", error: e.message };
      }
      await d.marcar(s.id, { a, b, estado: "pendiente", error: "Reintentando conexión con Odoo." });
      return { estado: "reintento", error: e.message, reintentarEnMs: espera(intentos) };
    }
    const msg = e instanceof TrasladoError ? e.message : "No se pudo sincronizar el conduce con Odoo.";
    await d.marcar(s.id, { a, b, estado: "error", error: msg });
    return { estado: "error", error: e instanceof TrasladoError && e.causa ? `${msg} [${e.codigo}: ${e.causa}]`.slice(0, 500) : msg };
  }
}
