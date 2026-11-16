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
  /** DS-17/DS-19: hay una ENTRADA confirmada ligada a esta salida (recepcion en obra / devolucion de obra con descuento): completa el paso B. */
  entradaConfirmada?: boolean;
  lineas: LineaSalida[];
  origenLocationId: number | null; origenWarehouseId: number | null;
  destinoLocationId: number | null;
  companyId: number;
}
export interface Biblioteca {
  buscar(origin: string): Promise<{ id: number; state: string } | null>;
  crear(e: { salidaId: string; paso: PasoTraslado; origin?: string; origenLocationId: number; destinoLocationId: number; pickingTypeId: number; companyId: number; items: ItemTraslado[]; folio?: string }): Promise<{ pickingId: number }>;
  validar(pickingId: number): Promise<{ estado: string }>;
  cancelar(pickingId: number): Promise<unknown>;
  devolver(pickingId: number, paso: PasoTraslado, salidaId: string, companyId: number, secuencia?: number): Promise<unknown>;
  transitoLocationId(): Promise<number>;
  tipoInterno(warehouseId: number): Promise<number>;
  /** DS-20: cantidad ya publicada por producto en los pickings cuyo origin empieza por `prefijo` (sin cancelados ni devoluciones). */
  publicado?(prefijo: string): Promise<Map<number, number>>;
  /** DS-20: pickings complemento (origin `<prefijo>-C…`) para poder revertirlos junto con el original. */
  complementos?(prefijo: string): Promise<Array<{ id: number; state: string }>>;
}
export interface DepsSalida {
  lib: Biblioteca;
  cargar(salidaId: string): Promise<DatosSalida | null>;
  marcar(salidaId: string, m: { a?: number; b?: number; estado: "pendiente" | "sincronizado" | "incierto" | "error"; error?: string }): Promise<void>;
  /** DS-28 (ADR 19): adjunta el PDF firmado del conduce al picking (`ir.attachment`). Devuelve null si no hay PDF o la fase expansion esta apagada. */
  adjuntarPdf?(pickingId: number, paso: PasoTraslado, s: DatosSalida): Promise<{ id: number; creado: boolean } | null>;
}
export interface ResultadoEvento { estado: "completado" | "reintento" | "error" | "incierto"; resultado?: Record<string, unknown>; error?: string; reintentarEnMs?: number }

export const MAX_INTENTOS = 8;
const espera = (intentos: number) => Math.min(10 * 60_000, 30_000 * 2 ** Math.max(0, intentos - 1));
const origen = (id: string, p: PasoTraslado) => `SGC-TRAS-${id}-${p}`;
const EPS = 1e-9;

/** DS-20: lo que SGC tiene de MAS que lo ya publicado en Odoo (lineas anadidas despues de publicar: material libre regularizado, etc.). */
export function calcularComplemento(items: ItemTraslado[], publicado: Map<number, number>): ItemTraslado[] {
  const pedido = new Map<number, ItemTraslado>();
  for (const i of items) {
    const p = pedido.get(i.productId);
    pedido.set(i.productId, p ? { ...p, cantidad: p.cantidad + i.cantidad } : { ...i });
  }
  const extras: ItemTraslado[] = [];
  for (const [pid, it] of pedido) {
    const resta = it.cantidad - (publicado.get(pid) ?? 0);
    if (resta > EPS) extras.push({ ...it, cantidad: resta });
  }
  return extras.sort((a, b) => a.productId - b.productId);
}
/** Sufijo determinista del complemento: el mismo conjunto de extras siempre produce el mismo origin (idempotente). */
export function huellaComplemento(extras: ItemTraslado[]): string {
  let h = 5381;
  for (const c of extras.map((e) => `${e.productId}:${e.cantidad}`).join("|")) h = ((h * 33) ^ c.charCodeAt(0)) >>> 0;
  return h.toString(36);
}

function itemsDe(s: DatosSalida, paso: PasoTraslado): ItemTraslado[] {
  return s.lineas
    .map((l) => ({ productId: l.odooProductId ?? 0, cantidad: paso === "A" ? l.cantidad : (l.cantidadRecibida ?? l.cantidad), uomId: l.odooUomId ?? undefined, nombre: l.nombre }))
    .filter((i) => i.cantidad > 0);
}

export async function publicarSalida(d: DepsSalida, salidaId: string, intentos: number): Promise<ResultadoEvento> {
  const s = await d.cargar(salidaId);
  if (!s) return { estado: "error", error: "La salida ya no existe en SGC." };
  let a: number | undefined; let b: number | undefined;
  try {
    const A = await d.lib.buscar(origen(s.id, "A")); const B = await d.lib.buscar(origen(s.id, "B"));
    // DS-19: real -> prueba DESPUES de publicar: el efecto en Odoo no puede quedar activo mientras SGC lo revierte -> se compensa.
    // Prueba que nunca se publico: no hay nada que hacer (nunca stock en la compania real).
    const hayEfecto = [A, B].some((p) => p && p.state !== "cancel") || ((await d.lib.complementos?.(`${origen(s.id, "A")}-C`)) ?? []).length > 0;
    if (s.esPrueba && !hayEfecto) return { estado: "completado", resultado: { omitido: "es_prueba" } };

    if (s.estado === "anulado" || s.estado === "rechazada" || s.esPrueba) {
      // B primero (deshacer en orden inverso), luego A
      const compA = (await d.lib.complementos?.(`${origen(s.id, "A")}-C`)) ?? []; const compB = (await d.lib.complementos?.(`${origen(s.id, "B")}-C`)) ?? [];
      const orden: Array<[PasoTraslado, { id: number; state: string } | null | undefined, boolean]> = [
        ...compB.map((k) => ["B", k, true] as [PasoTraslado, { id: number; state: string }, boolean]), ["B", B, false],
        ...compA.map((k) => ["A", k, true] as [PasoTraslado, { id: number; state: string }, boolean]), ["A", A, false],
      ];
      for (const [p, pk, esComp] of orden) {
        if (!pk || pk.state === "cancel") continue;
        if (pk.state === "done") await d.lib.devolver(pk.id, p, s.id, s.companyId, esComp ? pk.id : undefined); else await d.lib.cancelar(pk.id);
      }
      await d.marcar(s.id, { a: A?.id, b: B?.id, estado: "sincronizado" });
      return { estado: "completado", resultado: { revertido: true, por: s.esPrueba ? "es_prueba" : s.estado, picking_a: A?.id ?? null, picking_b: B?.id ?? null } };
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
    if (!A || A.state !== "done") {
      try {
        await d.lib.validar(a);
      } catch (e) {
        // Sin stock: el picking A recien creado quedaria huerfano en borrador (encontrado en el soak). Se cancela y se reporta el error.
        if (!A && e instanceof TrasladoError && e.codigo === "sin_stock") { try { await d.lib.cancelar(a); } catch { /* best-effort */ } a = undefined; }
        throw e;
      }
    }

    // DS-20: lineas anadidas DESPUES de publicar A (p. ej. material libre regularizado con movimiento) -> complemento idempotente.
    const comp: Record<string, number> = {};
    if (A && d.lib.publicado) {
      const extrasA = calcularComplemento(itemsA, await d.lib.publicado(origen(s.id, "A")));
      if (extrasA.length) {
        const oc = `${origen(s.id, "A")}-C${huellaComplemento(extrasA)}`;
        const previoC = await d.lib.buscar(oc);
        const pc = previoC ? { pickingId: previoC.id } : await d.lib.crear({ salidaId: s.id, paso: "A", origin: oc, origenLocationId: s.origenLocationId, destinoLocationId: transito, pickingTypeId: tipo, companyId: s.companyId, items: extrasA, folio: s.folio });
        if (!previoC || previoC.state !== "done") await d.lib.validar(pc.pickingId);
        comp.picking_a_complemento = pc.pickingId;
      }
    }

    // Paso B: parada entregada (ADR 4) o recepcion confirmada
    const quiereB = s.paradaEntregada || !!s.entradaConfirmada || s.estado === "entregado" || s.estado === "entregado_incompleto";
    let faltante = false;
    if (quiereB) {
      if (s.destinoLocationId == null) throw new TrasladoError("datos", "El destino del conduce no está vinculado con Odoo; el material queda en tránsito.");
      const itemsB = itemsDe(s, "B");
      faltante = s.lineas.some((l) => (l.cantidadRecibida ?? l.cantidad) < l.cantidad);
      if (itemsB.length) {
        const pb = B ? { pickingId: B.id } : await d.lib.crear({ salidaId: s.id, paso: "B", origenLocationId: transito, destinoLocationId: s.destinoLocationId, pickingTypeId: tipo, companyId: s.companyId, items: itemsB, folio: s.folio });
        b = pb.pickingId;
        if (!B || B.state !== "done") await d.lib.validar(b);
        if (B && d.lib.publicado) {
          const extrasB = calcularComplemento(itemsB, await d.lib.publicado(origen(s.id, "B")));
          if (extrasB.length) {
            const oc = `${origen(s.id, "B")}-C${huellaComplemento(extrasB)}`;
            const previoC = await d.lib.buscar(oc);
            const pc = previoC ? { pickingId: previoC.id } : await d.lib.crear({ salidaId: s.id, paso: "B", origin: oc, origenLocationId: transito, destinoLocationId: s.destinoLocationId, pickingTypeId: tipo, companyId: s.companyId, items: extrasB, folio: s.folio });
            if (!previoC || previoC.state !== "done") await d.lib.validar(pc.pickingId);
            comp.picking_b_complemento = pc.pickingId;
          }
        }
      }
    }
    // DS-28: el PDF firmado viaja como adjunto de los pickings. Un fallo aqui NO deshace la publicacion: queda visible en el aviso.
    let avisoAdjunto: string | undefined;
    if (d.adjuntarPdf) {
      for (const [p, pid] of [["A", a], ["B", b]] as Array<[PasoTraslado, number | undefined]>) {
        if (!pid) continue;
        try { const r = await d.adjuntarPdf(pid, p, s); if (r) comp[`adjunto_${p.toLowerCase()}`] = r.id; } catch (e) { avisoAdjunto = `No se pudo adjuntar el PDF firmado en Odoo (${e instanceof Error ? e.message.slice(0, 80) : "error"}).`; }
      }
    }
    // Un faltante real se queda en transito: queda visible (AT11) y espera la solicitud de ajuste aprobada (ADR 5).
    const avisoFaltante = faltante ? "Faltante en tránsito: pendiente de ajuste aprobado." : undefined;
    await d.marcar(s.id, { a, b, estado: "sincronizado", error: [avisoFaltante, avisoAdjunto].filter(Boolean).join(" ") || undefined });
    return { estado: "completado", resultado: { picking_a: a, picking_b: b ?? null, faltante_en_transito: faltante, ...comp } };
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
