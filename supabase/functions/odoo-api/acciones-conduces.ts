// odoo-api/acciones-conduces.ts — #202: al emitir un conduce, almacenes y
// existencias se leen DIRECTO de Odoo (no del stock local de SGC). Validación
// en el servidor; si Odoo no responde se bloquea, salvo contingencia de almacén
// o el interruptor ODOO_CONDUCE_FALLBACK_SGC=true (emergencia).
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import type { OdooClient } from "../_shared/odoo-client.ts";
import { idSeguro, ParamError } from "./acciones.ts";
import {
  ConduceStockError, fallbackSgcHabilitado, MAX_ARTICULOS_DISPONIBLE, MAX_ITEMS_VALIDAR,
  MENSAJE_FALLBACK_SGC, MENSAJE_ODOO_CAIDO, esOdooCaido, mensajeFaltantes, validarStockOdoo,
  type FaltanteEnriquecido, type ItemSalidaValidar,
} from "../_shared/odoo-stock-directo.ts";
import { disponibilidadPorProducto } from "../_shared/odoo-traslados.ts";

export const ACCIONES_CONDUCES = [
  "stock.disponible_bodega",
  "stock.disponible_productos",
  "stock.validar_salida",
  "salidas.emitir",
] as const;
export type AccionConduce = typeof ACCIONES_CONDUCES[number];
export const esAccionConduce = (a: string): a is AccionConduce =>
  (ACCIONES_CONDUCES as readonly string[]).includes(a);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const uuid = (v: unknown, campo: string): string => {
  if (typeof v !== "string" || !UUID.test(v)) throw new ParamError(`${campo} no es un ID válido.`);
  return v;
};

interface ItemIn { articulo_id: string; cantidad: number; talla?: string | null; unidad_capturada?: string | null; factor_aplicado?: number | null; origen_item_id?: string | null }

function leerItems(raw: unknown): ItemIn[] {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > MAX_ITEMS_VALIDAR) {
    throw new ParamError(`items debe ser una lista de 1 a ${MAX_ITEMS_VALIDAR} renglones.`);
  }
  const items: ItemIn[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") throw new ParamError("Cada renglón es inválido.");
    const o = r as Record<string, unknown>;
    const articulo_id = uuid(o.articulo_id, "articulo_id");
    const cantidad = Number(o.cantidad);
    if (!Number.isFinite(cantidad) || cantidad <= 0) throw new ParamError("La cantidad debe ser mayor que cero.");
    items.push({
      articulo_id, cantidad,
      talla: typeof o.talla === "string" ? o.talla : null,
      unidad_capturada: typeof o.unidad_capturada === "string" ? o.unidad_capturada : null,
      factor_aplicado: o.factor_aplicado == null || o.factor_aplicado === "" ? 1 : Number(o.factor_aplicado),
      origen_item_id: typeof o.origen_item_id === "string" && UUID.test(o.origen_item_id) ? o.origen_item_id : null,
    });
  }
  return items;
}

export interface BodegaOdoo {
  id: string; nombre: string;
  odoo_location_id: number | null; odoo_warehouse_id: number | null;
  codigo_odoo: string | null; fuente_odoo: boolean; contingencia: boolean;
}
export interface ArticuloOdoo { id: string; nombre: string; odoo_product_id: number | null }

export interface AdminSgc {
  bodega(id: string): Promise<BodegaOdoo | null>;
  articulos(ids: string[]): Promise<ArticuloOdoo[]>;
  registrarSalida(args: {
    fecha: string; bodega_id: string; proyecto_id: string | null; motivo: string;
    responsable: string | null; observaciones: string | null; creado_por: string;
    items: ItemIn[]; responsable_id: string | null; modo: "odoo" | "sgc" | "auto";
  }): Promise<string>;
}

// deno-lint-ignore no-explicit-any
type Any = any;

export function adminDesdeCliente(client: SupabaseClient): AdminSgc {
  return {
    async bodega(id) {
      const { data, error } = await client.from("bodegas").select("id, nombre, odoo_location_id, odoo_warehouse_id, codigo_odoo").eq("id", id).maybeSingle();
      if (error) throw new Error(`bodegas: ${error.message}`);
      if (!data) return null;
      const { data: corte } = await client.from("odoo_corte_bodega").select("fuente_odoo").eq("bodega_id", id).maybeSingle();
      const { data: cont } = await client.from("odoo_contingencias").select("id").eq("bodega_id", id).gt("vigente_hasta", new Date().toISOString()).limit(1);
      return {
        id: data.id, nombre: data.nombre,
        odoo_location_id: data.odoo_location_id ?? null,
        odoo_warehouse_id: data.odoo_warehouse_id ?? null,
        codigo_odoo: data.codigo_odoo ?? null,
        fuente_odoo: !!corte?.fuente_odoo,
        contingencia: !!(cont && cont.length),
      };
    },
    async articulos(ids) {
      if (!ids.length) return [];
      const { data, error } = await client.from("articulos").select("id, nombre, odoo_product_id").in("id", ids);
      if (error) throw new Error(`articulos: ${error.message}`);
      return (data ?? []).map((a: Any) => ({ id: a.id, nombre: a.nombre, odoo_product_id: a.odoo_product_id ?? null }));
    },
    async registrarSalida(args) {
      const { data, error } = await client.rpc("registrar_salida_conduce_odoo", {
        p_fecha: args.fecha, p_bodega_id: args.bodega_id, p_proyecto_id: args.proyecto_id,
        p_motivo: args.motivo, p_responsable: args.responsable, p_observaciones: args.observaciones,
        p_creado_por: args.creado_por, p_items: args.items, p_responsable_id: args.responsable_id,
        p_modo: args.modo,
      });
      if (error) throw new ConduceStockError("datos", error.message);
      if (!data) throw new ConduceStockError("datos", "No se pudo registrar el conduce.");
      return String(data);
    },
  };
}

async function preparar(admin: AdminSgc, bodegaId: string, items: ItemIn[]): Promise<{
  bodega: BodegaOdoo; itemsOdoo: ItemSalidaValidar[]; sinHomologar: string[];
}> {
  const bodega = await admin.bodega(bodegaId);
  if (!bodega) throw new ConduceStockError("datos", "El almacén no existe.");
  const arts = await admin.articulos(items.map((i) => i.articulo_id));
  const porId = new Map(arts.map((a) => [a.id, a]));
  const itemsOdoo: ItemSalidaValidar[] = [];
  const sinHomologar: string[] = [];
  for (const i of items) {
    const a = porId.get(i.articulo_id);
    if (!a) throw new ConduceStockError("datos", "Hay un artículo que no existe en el catálogo.");
    if (!a.odoo_product_id) sinHomologar.push(a.nombre);
    itemsOdoo.push({ articulo_id: a.id, cantidad: i.cantidad, nombre: a.nombre, odoo_product_id: a.odoo_product_id });
  }
  return { bodega, itemsOdoo, sinHomologar };
}

function exigirHomologacion(bodega: BodegaOdoo, sinHomologar: string[]): void {
  if (!bodega.odoo_location_id) {
    throw new ConduceStockError("no_homologado", `El almacén ${bodega.nombre} no está homologado con Odoo.`);
  }
  if (sinHomologar.length) {
    throw new ConduceStockError("no_homologado", `Estos artículos no están homologados con Odoo: ${sinHomologar.join(", ")}. Vincúlalos y reintenta.`);
  }
}

export interface ResultadoValidacion {
  ok: boolean;
  origen: "odoo" | "sgc" | "prueba";
  aviso?: string;
  consultado_en?: string;
  faltantes: FaltanteEnriquecido[];
  disponible?: Record<string, number>;
}

async function validarContraOdoo(
  odoo: OdooClient, bodega: BodegaOdoo, itemsOdoo: ItemSalidaValidar[], sinHomologar: string[],
): Promise<ResultadoValidacion> {
  exigirHomologacion(bodega, sinHomologar);
  try {
    const faltantes = await validarStockOdoo(odoo, bodega.odoo_location_id!, itemsOdoo);
    if (faltantes.length) throw new ConduceStockError("sin_stock", mensajeFaltantes(faltantes), faltantes);
    return { ok: true, origen: "odoo", consultado_en: new Date().toISOString(), faltantes: [] };
  } catch (e) {
    if (e instanceof ConduceStockError) throw e;
    if (esOdooCaido(e)) {
      if (bodega.contingencia || fallbackSgcHabilitado()) {
        return { ok: true, origen: "sgc", aviso: MENSAJE_FALLBACK_SGC, faltantes: [] };
      }
      throw new ConduceStockError("odoo_caido", MENSAJE_ODOO_CAIDO);
    }
    throw e;
  }
}

const r6 = (n: number) => Math.round(n * 1e6) / 1e6;

interface Ctx { odoo: OdooClient; admin: AdminSgc; usuarioId: string }

const disponibleBodega = {
  normalizar(p: Record<string, unknown>) {
    const bodega_id = uuid(p.bodega_id, "bodega_id");
    if (!Array.isArray(p.articulo_ids) || p.articulo_ids.length < 1 || p.articulo_ids.length > MAX_ARTICULOS_DISPONIBLE) {
      throw new ParamError(`articulo_ids debe ser una lista de 1 a ${MAX_ARTICULOS_DISPONIBLE} IDs.`);
    }
    const articulo_ids = [...new Set((p.articulo_ids as unknown[]).map((v, i) => uuid(v, `articulo_ids[${i}]`)))];
    return { bodega_id, articulo_ids };
  },
  async ejecutar(ctx: Ctx, p: { bodega_id: string; articulo_ids: string[] }) {
    const bodega = await ctx.admin.bodega(p.bodega_id);
    if (!bodega) throw new ConduceStockError("datos", "El almacén no existe.");
    const arts = await ctx.admin.articulos(p.articulo_ids);
    if (!bodega.fuente_odoo || !bodega.odoo_location_id) {
      return {
        origen: "sgc" as const, fuente_odoo: bodega.fuente_odoo, homologada: !!bodega.odoo_location_id,
        contingencia: bodega.contingencia, consultado_en: null, filas: [] as { articulo_id: string; nombre: string; disponible: number; odoo_product_id: number | null }[],
      };
    }
    const conId = arts.filter((a) => a.odoo_product_id);
    const mapa = conId.length
      ? await disponibilidadPorProducto(ctx.odoo, bodega.odoo_location_id, conId.map((a) => a.odoo_product_id!))
      : new Map<number, number>();
    return {
      origen: "odoo" as const, fuente_odoo: true, homologada: true, contingencia: bodega.contingencia,
      consultado_en: new Date().toISOString(),
      almacen: { nombre: bodega.nombre, codigo_odoo: bodega.codigo_odoo, location_id: bodega.odoo_location_id, warehouse_id: bodega.odoo_warehouse_id },
      filas: arts.map((a) => ({
        articulo_id: a.id, nombre: a.nombre, odoo_product_id: a.odoo_product_id,
        disponible: a.odoo_product_id ? r6(mapa.get(a.odoo_product_id) ?? 0) : 0,
      })),
    };
  },
};

const validarSalida = {
  normalizar(p: Record<string, unknown>) {
    return { bodega_id: uuid(p.bodega_id, "bodega_id"), items: leerItems(p.items) };
  },
  async ejecutar(ctx: Ctx, p: { bodega_id: string; items: ItemIn[] }) {
    const { bodega, itemsOdoo, sinHomologar } = await preparar(ctx.admin, p.bodega_id, p.items);
    if (!bodega.fuente_odoo) return { ok: true, origen: "sgc" as const, faltantes: [] };
    return await validarContraOdoo(ctx.odoo, bodega, itemsOdoo, sinHomologar);
  },
};

const emitir = {
  normalizar(p: Record<string, unknown>) {
    const fecha = String(p.fecha ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) throw new ParamError("fecha no es válida.");
    const motivo = String(p.motivo ?? "").trim();
    if (!motivo) throw new ParamError("El motivo es obligatorio.");
    return {
      fecha,
      bodega_id: uuid(p.bodega_id, "bodega_id"),
      proyecto_id: p.proyecto_id == null || p.proyecto_id === "" ? null : uuid(p.proyecto_id, "proyecto_id"),
      motivo,
      responsable: p.responsable == null ? null : String(p.responsable),
      responsable_id: p.responsable_id == null || p.responsable_id === "" ? null : uuid(p.responsable_id, "responsable_id"),
      observaciones: p.observaciones == null ? null : String(p.observaciones),
      items: leerItems(p.items),
    };
  },
  async ejecutar(ctx: Ctx, p: ReturnType<typeof emitir.normalizar>) {
    const { bodega, itemsOdoo, sinHomologar } = await preparar(ctx.admin, p.bodega_id, p.items);
    let modo: "odoo" | "sgc" | "auto" = "auto";
    let validacion: ResultadoValidacion = { ok: true, origen: "sgc", faltantes: [] };
    if (bodega.fuente_odoo) {
      validacion = await validarContraOdoo(ctx.odoo, bodega, itemsOdoo, sinHomologar);
      modo = validacion.origen === "odoo" ? "odoo" : "sgc";
    }
    const salida_id = await ctx.admin.registrarSalida({
      fecha: p.fecha, bodega_id: p.bodega_id, proyecto_id: p.proyecto_id, motivo: p.motivo,
      responsable: p.responsable, observaciones: p.observaciones, creado_por: ctx.usuarioId,
      items: p.items, responsable_id: p.responsable_id, modo,
    });
    return { salida_id, validacion: validacion.origen, aviso: validacion.aviso ?? null, consultado_en: validacion.consultado_en ?? null };
  },
};


const disponibleProductos = {
  normalizar(p: Record<string, unknown>) {
    const bodega_id = uuid(p.bodega_id, "bodega_id");
    if (!Array.isArray(p.product_ids) || p.product_ids.length < 1 || p.product_ids.length > MAX_ARTICULOS_DISPONIBLE) {
      throw new ParamError(`product_ids debe ser una lista de 1 a ${MAX_ARTICULOS_DISPONIBLE} IDs.`);
    }
    const product_ids = [...new Set(p.product_ids.map((v) => {
      const id = idSeguro(v, "product_ids");
      if (!id) throw new ParamError("product_ids no es un ID de Odoo válido.");
      return id;
    }))].sort((a, b) => a - b);
    return { bodega_id, product_ids };
  },
  async ejecutar(ctx: Ctx, p: { bodega_id: string; product_ids: number[] }) {
    const bodega = await ctx.admin.bodega(p.bodega_id);
    if (!bodega) throw new ConduceStockError("datos", "El almacén no existe.");
    if (!bodega.fuente_odoo || !bodega.odoo_location_id) {
      return {
        origen: "sgc" as const, fuente_odoo: bodega.fuente_odoo, homologada: !!bodega.odoo_location_id,
        contingencia: bodega.contingencia, consultado_en: null,
        filas: p.product_ids.map((producto_id) => ({ producto_id, disponible: 0, fisica: 0, reservada: 0 })),
      };
    }
    const mapa = await disponibilidadPorProducto(ctx.odoo, bodega.odoo_location_id, p.product_ids);
    return {
      origen: "odoo" as const, fuente_odoo: true, homologada: true, contingencia: bodega.contingencia,
      consultado_en: new Date().toISOString(),
      almacen: { nombre: bodega.nombre, codigo_odoo: bodega.codigo_odoo, location_id: bodega.odoo_location_id, warehouse_id: bodega.odoo_warehouse_id },
      filas: p.product_ids.map((producto_id) => {
        const disponible = r6(mapa.get(producto_id) ?? 0);
        return { producto_id, disponible, fisica: disponible, reservada: 0 };
      }),
    };
  },
};

export const DEFINICIONES_CONDUCES = {
  "stock.disponible_bodega": disponibleBodega,
  "stock.disponible_productos": disponibleProductos,
  "stock.validar_salida": validarSalida,
  "salidas.emitir": emitir,
};
