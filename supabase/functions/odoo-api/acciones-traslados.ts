// odoo-api/acciones-traslados.ts — DS-08/DS-10: acciones del gateway sobre traslados A/B (_shared/odoo-traslados.ts).
//
// Lecturas (traslados.obtener, traslados.listar): módulo `inventario`, sin caché, SOLO pickings SGC (origin SGC-TRAS-…).
// Escrituras (traslados.crear/validar/cancelar/devolver): módulo `inventario`, sin caché ni reintento automático, y
// SOLO si la política de escritura lo permite (host autorizado por la guardia DS-02 + ODOO_ESCRITURA_HABILITADA).
// El cliente nunca manda ubicaciones, productos ni cantidades (D5): `crear` recibe el id de la salida SGC y el edge relee
// todo de la BD con service role; las demás reciben el id del picking y el edge comprueba que sea un traslado SGC
// (origin con el prefijo) y deduce salida/paso del origin. Todas son idempotentes por `origin`.
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { ParamError } from "./acciones.ts";
import { idSeguro } from "./acciones.ts";
import {
  cancelarTraslado, crearTraslado, devolverTraslado, type ItemTraslado, listarTraslados, type LlamadorOdoo, obtenerTraslado,
  type PasoTraslado, PREFIJO_ORIGIN, TrasladoError, validarTraslado,
} from "../_shared/odoo-traslados.ts";

export const ACCIONES_TRASLADOS_LECTURA = ["traslados.obtener", "traslados.listar"] as const;
export const ACCIONES_TRASLADOS_ESCRITURA = ["traslados.crear", "traslados.validar", "traslados.cancelar", "traslados.devolver"] as const;
export type AccionTrasladoLectura = typeof ACCIONES_TRASLADOS_LECTURA[number];
export type AccionTrasladoEscritura = typeof ACCIONES_TRASLADOS_ESCRITURA[number];

export const esAccionTrasladoLectura = (a: string): a is AccionTrasladoLectura => (ACCIONES_TRASLADOS_LECTURA as readonly string[]).includes(a);
export const esAccionTrasladoEscritura = (a: string): a is AccionTrasladoEscritura => (ACCIONES_TRASLADOS_ESCRITURA as readonly string[]).includes(a);

/** Lo que las acciones necesitan del cliente Odoo (OdooClient lo cumple). */
export type OdooTraslados = LlamadorOdoo & { companyId: number };
export interface CtxTraslados { odoo: OdooTraslados; admin: SupabaseClient; usuarioId: string }

const RX_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RX_ORIGIN = new RegExp(`^${PREFIJO_ORIGIN}([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-([AB])(?:-.*)?$`, "i");
const MAX_LIMITE = 200;

// deno-lint-ignore no-explicit-any
type Any = any;

const pickingId = (p: Record<string, unknown>): number => {
  const id = idSeguro(p.picking_id, "picking_id");
  if (!id) throw new ParamError("picking_id es obligatorio.");
  return id;
};

/** Defensa: nunca se toca un picking que no sea un traslado de SGC. Devuelve salida y paso deducidos del origin. */
async function exigirTrasladoSgc(c: LlamadorOdoo, id: number): Promise<{ salidaId: string; paso: PasoTraslado }> {
  const p = await obtenerTraslado(c, id);
  if (!p) throw new ParamError("El movimiento no existe en Odoo.");
  const m = RX_ORIGIN.exec(String(p.origin ?? ""));
  if (!m) throw new ParamError("Ese movimiento de Odoo no fue creado desde SGC; no se puede operar desde aquí.");
  return { salidaId: m[1].toLowerCase(), paso: m[2].toUpperCase() as PasoTraslado };
}

interface DefLectura<P> { normalizar(p: Record<string, unknown>): P; ejecutar(odoo: OdooTraslados, p: P): Promise<unknown> }
interface DefEscritura<P> { normalizar(p: Record<string, unknown>): P; ejecutar(ctx: CtxTraslados, p: P): Promise<unknown> }

const resumen = (p: Any) => ({
  picking_id: p.id, nombre: p.name, estado: p.state, origin: p.origin,
  origen: p.location_id?.[1] ?? null, destino: p.location_dest_id?.[1] ?? null, modificado: p.write_date ?? null,
});

const trasladosObtener: DefLectura<{ picking_id: number }> = {
  normalizar: (p) => ({ picking_id: pickingId(p) }),
  async ejecutar(odoo, { picking_id }) {
    const p = await obtenerTraslado(odoo, picking_id);
    if (!p) return { traslado: null };
    if (!RX_ORIGIN.test(String(p.origin ?? ""))) throw new ParamError("Ese movimiento de Odoo no fue creado desde SGC.");
    return { traslado: { ...resumen(p), movimientos: Array.isArray(p.move_ids) ? p.move_ids.length : 0 } };
  },
};

const trasladosListar: DefLectura<{ salida_id: string | null; desde: string | null; limite: number }> = {
  normalizar(p) {
    if (p.salida_id !== undefined && p.salida_id !== null && (typeof p.salida_id !== "string" || !RX_UUID.test(p.salida_id))) {
      throw new ParamError("salida_id debe ser un UUID válido.");
    }
    if (p.desde !== undefined && p.desde !== null && (typeof p.desde !== "string" || !/^\d{4}-\d{2}-\d{2}( \d{2}:\d{2}:\d{2})?$/.test(p.desde))) {
      throw new ParamError("desde debe tener el formato AAAA-MM-DD.");
    }
    let limite = 50;
    if (p.limite !== undefined && p.limite !== null) {
      if (typeof p.limite !== "number" || !Number.isInteger(p.limite) || p.limite < 1 || p.limite > MAX_LIMITE) throw new ParamError(`limite debe ser un entero entre 1 y ${MAX_LIMITE}.`);
      limite = p.limite;
    }
    return { salida_id: (p.salida_id as string | undefined)?.toLowerCase() ?? null, desde: (p.desde as string | undefined) ?? null, limite };
  },
  async ejecutar(odoo, p) {
    const filas = await listarTraslados(odoo, { salidaId: p.salida_id ?? undefined, desde: p.desde ?? undefined, limite: p.limite });
    return { traslados: filas.map(resumen) };
  },
};

// ── Escrituras ────────────────────────────────────────────────────────────
const normalizarPaso = (v: unknown): PasoTraslado => {
  if (v !== "A" && v !== "B") throw new ParamError("paso debe ser A (despacho) o B (llegada).");
  return v;
};

interface LineaDb { nombre: string; cantidad: number; recibida: number | null; productId: number | null }

const trasladosCrear: DefEscritura<{ salida_id: string; paso: PasoTraslado }> = {
  normalizar(p) {
    if (typeof p.salida_id !== "string" || !RX_UUID.test(p.salida_id)) throw new ParamError("salida_id es obligatorio y debe ser un UUID válido.");
    return { salida_id: p.salida_id.toLowerCase(), paso: normalizarPaso(p.paso) };
  },
  async ejecutar({ odoo, admin }, { salida_id, paso }) {
    // D5: todo sale de la BD de SGC, nada del cliente.
    const { data: s } = await admin.from("salidas_inventario").select("id, folio, estado, es_prueba, bodega_id, destino_almacen_id, proyecto_id").eq("id", salida_id).maybeSingle();
    if (!s) throw new ParamError("La salida no existe en SGC.");
    if (s.es_prueba) throw new ParamError("Las salidas de prueba no se publican en Odoo.");
    if (s.estado === "anulado" || s.estado === "rechazada") throw new ParamError("La salida está anulada o rechazada; no se crea el traslado.");
    const { data: det } = await admin.from("detalle_salidas").select("cantidad, cantidad_recibida, articulos(nombre, odoo_product_id)").eq("salida_id", salida_id);
    const lineas: LineaDb[] = ((det ?? []) as Any[]).map((d) => ({
      nombre: d.articulos?.nombre ?? "artículo", cantidad: Number(d.cantidad), recibida: d.cantidad_recibida == null ? null : Number(d.cantidad_recibida), productId: d.articulos?.odoo_product_id ?? null,
    }));
    const items: ItemTraslado[] = lineas.map((l) => ({ productId: l.productId ?? 0, cantidad: paso === "A" ? l.cantidad : (l.recibida ?? l.cantidad), nombre: l.nombre })).filter((i) => i.cantidad > 0);
    if (!items.length) throw new ParamError("La salida no tiene cantidades para trasladar.");
    const sinVinculo = items.filter((i) => !i.productId);
    if (sinVinculo.length) throw new ParamError(`Hay ${sinVinculo.length} artículo(s) sin vincular a Odoo; vincúlalos en Homologación antes de publicar.`);

    const { data: bo } = await admin.from("bodegas").select("odoo_location_id, odoo_warehouse_id").eq("id", s.bodega_id).maybeSingle();
    let destino: number | null = null;
    if (s.destino_almacen_id) {
      const { data } = await admin.from("bodegas").select("odoo_location_id").eq("id", s.destino_almacen_id).maybeSingle();
      destino = data?.odoo_location_id ?? null;
    } else if (s.proyecto_id) {
      const { data } = await admin.from("bodegas").select("odoo_location_id").eq("proyecto_id", s.proyecto_id).eq("activo", true).limit(1);
      destino = data?.[0]?.odoo_location_id ?? null;
    }
    if (!bo?.odoo_location_id || !bo?.odoo_warehouse_id) throw new ParamError("El almacén de origen no está homologado con Odoo.");
    if (!destino) throw new ParamError("El destino no está homologado con Odoo.");

    // Ubicación de tránsito única y tipo de operación interno del almacén de origen (se leen de Odoo, no del cliente).
    const tr = await odoo.call("stock.location", "search_read", [[["usage", "=", "transit"], ["active", "=", true]]], { fields: ["id"], limit: 2 });
    if (!Array.isArray(tr) || tr.length !== 1) throw new ParamError("No hay una única ubicación de tránsito en Odoo.");
    const transito: number = tr[0].id;
    const wh = await odoo.call("stock.warehouse", "search_read", [[["id", "=", bo.odoo_warehouse_id]]], { fields: ["int_type_id"], limit: 1 });
    const tipo = wh?.[0]?.int_type_id?.[0];
    if (!tipo) throw new ParamError("El almacén no tiene tipo de operación interna en Odoo.");

    const r = await crearTraslado(odoo, {
      salidaId: salida_id, paso, pickingTypeId: tipo, companyId: odoo.companyId, items, folio: s.folio ?? undefined,
      origenLocationId: paso === "A" ? bo.odoo_location_id : transito,
      destinoLocationId: paso === "A" ? transito : destino,
    });
    return { picking_id: r.pickingId, nombre: r.nombre, estado: r.estado, repetido: r.reutilizado };
  },
};

const trasladosValidar: DefEscritura<{ picking_id: number }> = {
  normalizar: (p) => ({ picking_id: pickingId(p) }),
  async ejecutar({ odoo }, { picking_id }) {
    await exigirTrasladoSgc(odoo, picking_id);
    const r = await validarTraslado(odoo, picking_id);
    return { picking_id: r.pickingId, nombre: r.nombre, estado: r.estado, repetido: r.reutilizado };
  },
};

const trasladosCancelar: DefEscritura<{ picking_id: number }> = {
  normalizar: (p) => ({ picking_id: pickingId(p) }),
  async ejecutar({ odoo }, { picking_id }) {
    await exigirTrasladoSgc(odoo, picking_id);
    const r = await cancelarTraslado(odoo, picking_id);
    return { picking_id, estado: r.estado };
  },
};

const trasladosDevolver: DefEscritura<{ picking_id: number; secuencia: number }> = {
  normalizar(p) {
    let secuencia = 1;
    if (p.secuencia !== undefined && p.secuencia !== null) {
      if (typeof p.secuencia !== "number" || !Number.isInteger(p.secuencia) || p.secuencia < 1 || p.secuencia > 20) throw new ParamError("secuencia debe ser un entero entre 1 y 20.");
      secuencia = p.secuencia;
    }
    return { picking_id: pickingId(p), secuencia };
  },
  async ejecutar({ odoo }, { picking_id, secuencia }) {
    const { salidaId, paso } = await exigirTrasladoSgc(odoo, picking_id);
    const r = await devolverTraslado(odoo, picking_id, { salidaId, paso, secuencia, companyId: odoo.companyId });
    return { picking_id: r.pickingId, nombre: r.nombre, estado: r.estado, repetido: r.reutilizado };
  },
};

export const DEFINICIONES_TRASLADOS_LECTURA: { [A in AccionTrasladoLectura]: DefLectura<never> } = {
  "traslados.obtener": trasladosObtener,
  "traslados.listar": trasladosListar,
} as unknown as { [A in AccionTrasladoLectura]: DefLectura<never> };

export const DEFINICIONES_TRASLADOS_ESCRITURA: { [A in AccionTrasladoEscritura]: DefEscritura<never> } = {
  "traslados.crear": trasladosCrear,
  "traslados.validar": trasladosValidar,
  "traslados.cancelar": trasladosCancelar,
  "traslados.devolver": trasladosDevolver,
} as unknown as { [A in AccionTrasladoEscritura]: DefEscritura<never> };

/** Error de negocio del traslado → mensaje apto para el usuario (BS2); la causa técnica queda en el log del servidor. */
export const esErrorDeNegocioTraslado = (e: unknown): e is TrasladoError => e instanceof TrasladoError;
