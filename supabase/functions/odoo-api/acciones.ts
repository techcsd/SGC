// odoo-api/acciones.ts — allowlist cerrada de acciones de LECTURA contra Odoo.
// El navegador solo elige `accion` + parámetros tipados; modelo, método, dominio
// y campos los fija este archivo. Cada acción separa `normalizar` (valida y deja los
// parámetros en forma canónica → sirve de clave de caché) de `ejecutar` (la lectura).
import type { OdooClient } from "../_shared/odoo-client.ts";
import { CAMPOS_PROVEEDOR, dominioCompaniaPartner, leerProveedores, proveedorDesdeFila } from "../_shared/odoo-proveedores.ts";

export class ParamError extends Error {}

export const ACCIONES = [
  "productos.buscar", "ubicaciones.listar", "stock.consultar",
  // CY24 Fase A — lectura para el piloto de OC (solo lectura; crear/confirmar es Fase C).
  "productos.buscar_compra", "productos.obtener", "proveedores.obtener", "compras.obtener",
  // Estado vivo de OCs (nada se espeja en SGC): lectura por lote, sin caché (ver ACCIONES_SIN_CACHE).
  "compras.obtener_varias",
  // Proveedores directo en Odoo (res.partner): búsqueda paginada y lectura por lote, sin caché.
  "proveedores.buscar", "proveedores.obtener_varios",
] as const;
export type Accion = typeof ACCIONES[number];

/** Estado vivo de la OC: se lee siempre de Odoo, nunca del caché SWR. */
export const ACCIONES_SIN_CACHE: readonly Accion[] = [
  "compras.obtener", "compras.obtener_varias",
  // Proveedores: lo recién escrito (alta, edición, archivado) debe verse al instante.
  "proveedores.buscar", "proveedores.obtener", "proveedores.obtener_varios",
];

export const MAX_TAMANO = 100;
export const MAX_ORDENES_LOTE = 100;
export const MAX_PAGINA = 200; // offset profundo = Odoo agrupa y descarta filas
export const MAX_UBICACIONES = 500;
export const MAX_PROVEEDORES_LOTE = 100;
export const MAX_TERMINO_PROVEEDOR = 80;

export const idSeguro = (v: unknown, campo: string): number | null => {
  if (v === undefined || v === null || v === "") return null;
  const n = typeof v === "string" && /^\d{1,15}$/.test(v) ? Number(v) : v;
  if (typeof n !== "number" || !Number.isSafeInteger(n) || n <= 0) throw new ParamError(`${campo} no es un ID de Odoo válido.`);
  return n;
};

const entero = (v: unknown, campo: string, def: number, min: number, max: number): number => {
  if (v === undefined || v === null) return def;
  if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max) throw new ParamError(`${campo} fuera de rango.`);
  return v;
};

// Odoo devuelve many2one como [id, "nombre"] o false.
const m2o = (v: unknown): { id: number; nombre: string } | null =>
  Array.isArray(v) && typeof v[0] === "number" ? { id: v[0], nombre: String(v[1] ?? "") } : null;

const dominioCompania = (cid: number) => ["|", ["company_id", "=", false], ["company_id", "=", cid]];

/** Redondea a 6 decimales: evita 0.30000000000000004 de la aritmética flotante. */
const r6 = (n: number) => Math.round(n * 1e6) / 1e6;

// deno-lint-ignore no-control-regex
export const CONTROL = /[\u0000-\u001F\u007F]/g;

interface Def<P> {
  normalizar(p: Record<string, unknown>): P;
  ejecutar(odoo: OdooClient, p: P): Promise<unknown>;
}

/** `ilike` de Odoo no escapa comodines: `%`/`_` del usuario se tratarían como patrón. Postgres escapa con `\\`. */
export const escapaLike = (t: string) => t.replace(/[\\%_]/g, (c) => `\\${c}`);

const productosBuscar: Def<{ termino: string; limite: number }> = {
  normalizar(p) {
    const termino = String(p.termino ?? "").replace(CONTROL, " ").replace(/\s+/g, " ").trim();
    if (termino.length < 2 || termino.length > 80) throw new ParamError("El término de búsqueda debe tener entre 2 y 80 caracteres.");
    return { termino, limite: entero(p.limite, "limite", 20, 1, 50) };
  },
  async ejecutar(odoo, { termino: crudo, limite }) {
    const termino = escapaLike(crudo);
    const filas = await odoo.call("product.product", "search_read", [[
      ["active", "=", true],
      ["type", "=", "product"],
      ...dominioCompania(odoo.companyId),
      "|", ["name", "ilike", termino], ["default_code", "ilike", termino],
    ]], { fields: ["id", "display_name", "default_code", "uom_id", "categ_id"], limit: limite, order: "display_name asc" });
    return {
      productos: (filas as Record<string, unknown>[]).map((f) => ({
        id: f.id as number,
        nombre: String(f.display_name ?? ""),
        codigo: f.default_code ? String(f.default_code) : null,
        unidad: m2o(f.uom_id)?.nombre ?? null,
        categoria: m2o(f.categ_id)?.nombre ?? null,
      })),
    };
  },
};

const ubicacionesListar: Def<Record<string, never>> = {
  normalizar: () => ({}),
  async ejecutar(odoo) {
    // Pedimos una fila de más para avisar si la lista se truncó (en vez de cortar en silencio).
    const filas = await odoo.call("stock.location", "search_read", [[
      ["usage", "=", "internal"], ["active", "=", true], ["company_id", "=", odoo.companyId],
    ]], { fields: ["id", "complete_name", "warehouse_id"], limit: MAX_UBICACIONES + 1, order: "complete_name asc" }) as Record<string, unknown>[];
    return {
      truncado: filas.length > MAX_UBICACIONES,
      ubicaciones: filas.slice(0, MAX_UBICACIONES).map((f) => ({
        id: f.id as number,
        nombre: String(f.complete_name ?? ""),
        almacen: m2o(f.warehouse_id)?.nombre ?? null,
      })),
    };
  },
};

const stockConsultar: Def<{ producto_id: number | null; ubicacion_id: number | null; pagina: number; tamano: number }> = {
  normalizar(p) {
    return {
      producto_id: idSeguro(p.producto_id, "producto_id"),
      ubicacion_id: idSeguro(p.ubicacion_id, "ubicacion_id"),
      pagina: entero(p.pagina, "pagina", 1, 1, MAX_PAGINA),
      tamano: entero(p.tamano, "tamano", 25, 1, MAX_TAMANO),
    };
  },
  async ejecutar(odoo, { producto_id, ubicacion_id, pagina, tamano }) {
    const dominio: unknown[] = [["location_id.usage", "=", "internal"], ["company_id", "=", odoo.companyId]];
    if (producto_id) dominio.push(["product_id", "=", producto_id]);
    if (ubicacion_id) dominio.push(["location_id", "child_of", ubicacion_id]);
    // Una sola llamada agrupada; pedimos tamano+1 para saber si hay otra página
    // sin una segunda consulta de conteo.
    const grupos = await odoo.call("stock.quant", "read_group", [dominio, ["quantity:sum", "reserved_quantity:sum"], ["product_id", "location_id"]], {
      lazy: false, limit: tamano + 1, offset: (pagina - 1) * tamano, orderby: "product_id asc, location_id asc",
    }) as Record<string, unknown>[];
    return {
      pagina, tamano, hay_mas: grupos.length > tamano,
      filas: grupos.slice(0, tamano).map((g) => {
        const fisica = r6(Number(g.quantity ?? 0));
        const reservada = r6(Number(g.reserved_quantity ?? 0));
        return {
          producto: m2o(g.product_id),
          ubicacion: m2o(g.location_id),
          cantidad_fisica: fisica,
          cantidad_reservada: reservada,
          cantidad_disponible: r6(fisica - reservada),
        };
      }),
    };
  },
};

// ── CY24 Fase A — lectura para el piloto de OC ──────────────────────────────
// "Variante compras" de productos.buscar: filtra por purchase_ok en vez de
// type='product' (un servicio o un kit tambien puede comprarse) -- a
// propósito NO se limita a type='product' (pide el criterio E2/E8 de #24).
const productosBuscarCompra: Def<{ termino: string; limite: number }> = {
  normalizar: productosBuscar.normalizar,
  async ejecutar(odoo, { termino: crudo, limite }) {
    const termino = escapaLike(crudo);
    const filas = await odoo.call("product.product", "search_read", [[
      ["active", "=", true],
      ["purchase_ok", "=", true],
      ...dominioCompania(odoo.companyId),
      "|", ["name", "ilike", termino], ["default_code", "ilike", termino],
    ]], { fields: ["id", "display_name", "default_code", "uom_id", "uom_po_id", "categ_id"], limit: limite, order: "display_name asc" });
    return {
      productos: (filas as Record<string, unknown>[]).map((f) => ({
        id: f.id as number,
        nombre: String(f.display_name ?? ""),
        codigo: f.default_code ? String(f.default_code) : null,
        unidad: m2o(f.uom_id)?.nombre ?? null,
        unidad_compra: m2o(f.uom_po_id)?.nombre ?? null,
        // CY24 (#24, D1) -- el id numérico de la UoM de compra, para persistir
        // orden_compra_items.odoo_uom_id (el nombre solo no basta, es display).
        unidad_compra_id: m2o(f.uom_po_id)?.id ?? null,
        categoria: m2o(f.categ_id)?.nombre ?? null,
      })),
    };
  },
};

const productosObtener: Def<{ producto_id: number }> = {
  normalizar(p) {
    const producto_id = idSeguro(p.producto_id, "producto_id");
    if (!producto_id) throw new ParamError("producto_id es obligatorio.");
    return { producto_id };
  },
  async ejecutar(odoo, { producto_id }) {
    const filas = await odoo.call("product.product", "search_read", [
      [["id", "=", producto_id], ...dominioCompania(odoo.companyId)],
    ], { fields: ["id", "display_name", "default_code", "uom_id", "uom_po_id", "categ_id", "active", "purchase_ok", "taxes_id"], limit: 1 }) as Record<string, unknown>[];
    const f = filas[0];
    if (!f) return { producto: null };
    return {
      producto: {
        id: f.id as number,
        nombre: String(f.display_name ?? ""),
        codigo: f.default_code ? String(f.default_code) : null,
        unidad: m2o(f.uom_id)?.nombre ?? null,
        unidad_compra: m2o(f.uom_po_id)?.nombre ?? null,
        categoria: m2o(f.categ_id)?.nombre ?? null,
        activo: !!f.active,
        comprable: !!f.purchase_ok,
        impuestos_ids: Array.isArray(f.taxes_id) ? f.taxes_id : [],
      },
    };
  },
};

const proveedoresObtener: Def<{ proveedor_id: number }> = {
  normalizar(p) {
    const proveedor_id = idSeguro(p.proveedor_id, "proveedor_id");
    if (!proveedor_id) throw new ParamError("proveedor_id es obligatorio.");
    return { proveedor_id };
  },
  async ejecutar(odoo, { proveedor_id }) {
    // Incluye archivados: devuelve activo:false en vez de null.
    const [proveedor] = await leerProveedores(odoo, [proveedor_id]);
    return { proveedor: proveedor ?? null };
  },
};

const proveedoresObtenerVarios: Def<{ proveedor_ids: number[] }> = {
  normalizar(p) {
    if (!Array.isArray(p.proveedor_ids) || p.proveedor_ids.length < 1 || p.proveedor_ids.length > MAX_PROVEEDORES_LOTE) {
      throw new ParamError(`proveedor_ids debe ser una lista de 1 a ${MAX_PROVEEDORES_LOTE} IDs.`);
    }
    const ids = p.proveedor_ids.map((v) => {
      const id = idSeguro(v, "proveedor_ids");
      if (!id) throw new ParamError("proveedor_ids no es un ID de Odoo válido.");
      return id;
    });
    return { proveedor_ids: [...new Set(ids)].sort((a, b) => a - b) };
  },
  async ejecutar(odoo, { proveedor_ids }) {
    return { proveedores: await leerProveedores(odoo, proveedor_ids) };
  },
};

type EstadoProveedor = "activos" | "inactivos" | "todos";

const proveedoresBuscar: Def<{ termino: string; estado: EstadoProveedor; pagina: number; tamano: number }> = {
  normalizar(p) {
    const termino = String(p.termino ?? "").replace(CONTROL, " ").replace(/\s+/g, " ").trim();
    if (termino.length > MAX_TERMINO_PROVEEDOR) throw new ParamError(`El término de búsqueda no puede pasar de ${MAX_TERMINO_PROVEEDOR} caracteres.`);
    const estado = p.estado ?? "activos";
    if (estado !== "activos" && estado !== "inactivos" && estado !== "todos") throw new ParamError("estado debe ser activos, inactivos o todos.");
    return { termino, estado, pagina: entero(p.pagina, "pagina", 1, 1, MAX_PAGINA), tamano: entero(p.tamano, "tamano", 50, 1, MAX_TAMANO) };
  },
  async ejecutar(odoo, { termino: crudo, estado, pagina, tamano }) {
    const dominio: unknown[] = [["supplier_rank", ">", 0], ...dominioCompaniaPartner(odoo.companyId)];
    if (estado === "activos") dominio.push(["active", "=", true]);
    if (estado === "inactivos") dominio.push(["active", "=", false]);
    if (crudo) {
      const termino = escapaLike(crudo);
      const condiciones: unknown[] = [["name", "ilike", termino], ["email", "ilike", termino], ["vat", "ilike", termino]];
      // El RNC puede venir con guiones ("131-12345-6"): también se busca solo por sus dígitos.
      const digitos = crudo.replace(/\D/g, "");
      if (digitos && digitos !== crudo) condiciones.push(["vat", "ilike", digitos]);
      dominio.push(...Array(condiciones.length - 1).fill("|"), ...condiciones);
    }
    // Sin active_test:false Odoo oculta los archivados aunque el dominio los pida.
    const filas = await odoo.call("res.partner", "search_read", [dominio], {
      fields: CAMPOS_PROVEEDOR, limit: tamano + 1, offset: (pagina - 1) * tamano, order: "name asc",
      ...(estado === "activos" ? {} : { context: { active_test: false } }),
    }) as Record<string, unknown>[];
    return { proveedores: filas.slice(0, tamano).map(proveedorDesdeFila), pagina, tamano, hay_mas: filas.length > tamano };
  },
};

const CAMPOS_COMPRA = ["id", "name", "state", "amount_total", "date_order", "partner_id", "currency_id", "picking_ids"];

type FilaOdoo = Record<string, unknown>;

/** Mapea purchase.order + sus recepciones (stock.picking) a la forma que ve el cliente. */
const mapOrden = (f: FilaOdoo, recepciones: FilaOdoo[]) => ({
  id: f.id as number,
  nombre: String(f.name ?? ""),
  estado: String(f.state ?? ""),
  total: r6(Number(f.amount_total ?? 0)),
  fecha: f.date_order ? String(f.date_order) : null,
  proveedor: m2o(f.partner_id),
  moneda: m2o(f.currency_id)?.nombre ?? null,
  recibida_en_odoo: recepciones.some((k) => k.state === "done"),
  recepciones_hechas: recepciones.filter((k) => k.state === "done").length,
  recepciones_total: recepciones.length,
});

/** Lee las órdenes por ids (con filtro de compañía) y sus recepciones en UNA segunda consulta. */
async function leerOrdenes(odoo: OdooClient, ids: number[]) {
  const filas = await odoo.call("purchase.order", "search_read", [
    [["id", "in", ids], ...dominioCompania(odoo.companyId)],
  ], { fields: CAMPOS_COMPRA, limit: ids.length }) as FilaOdoo[];
  const idsPick = [...new Set(filas.flatMap((f) => Array.isArray(f.picking_ids) ? f.picking_ids : []))]
    .filter((v): v is number => typeof v === "number" && Number.isSafeInteger(v) && v > 0);
  const picks = idsPick.length
    ? await odoo.call("stock.picking", "search_read", [[["id", "in", idsPick]]], { fields: ["id", "state"] }) as FilaOdoo[]
    : [];
  const estadoPick = new Map(picks.map((k) => [k.id, k]));
  return filas.map((f) => mapOrden(
    f, (Array.isArray(f.picking_ids) ? f.picking_ids : []).map((i) => estadoPick.get(i)).filter((k): k is FilaOdoo => !!k),
  ));
}

const comprasObtener: Def<{ orden_id: number }> = {
  normalizar(p) {
    const orden_id = idSeguro(p.orden_id, "orden_id");
    if (!orden_id) throw new ParamError("orden_id es obligatorio.");
    return { orden_id };
  },
  async ejecutar(odoo, { orden_id }) {
    const [orden] = await leerOrdenes(odoo, [orden_id]);
    return { orden: orden ?? null };
  },
};

const comprasObtenerVarias: Def<{ orden_ids: number[] }> = {
  normalizar(p) {
    if (!Array.isArray(p.orden_ids) || p.orden_ids.length < 1 || p.orden_ids.length > MAX_ORDENES_LOTE) {
      throw new ParamError(`orden_ids debe ser una lista de 1 a ${MAX_ORDENES_LOTE} IDs.`);
    }
    // Sin duplicados y ordenados: queda en forma canónica.
    const ids = p.orden_ids.map((v) => {
      const id = idSeguro(v, "orden_ids");
      if (!id) throw new ParamError("orden_ids no es un ID de Odoo válido.");
      return id;
    });
    return { orden_ids: [...new Set(ids)].sort((a, b) => a - b) };
  },
  async ejecutar(odoo, { orden_ids }) {
    return { ordenes: await leerOrdenes(odoo, orden_ids) };
  },
};

export const DEFINICIONES: { [A in Accion]: Def<never> } = {
  "productos.buscar": productosBuscar,
  "ubicaciones.listar": ubicacionesListar,
  "stock.consultar": stockConsultar,
  "productos.buscar_compra": productosBuscarCompra,
  "productos.obtener": productosObtener,
  "proveedores.obtener": proveedoresObtener,
  "compras.obtener": comprasObtener,
  "compras.obtener_varias": comprasObtenerVarias,
  "proveedores.buscar": proveedoresBuscar,
  "proveedores.obtener_varios": proveedoresObtenerVarios,
} as unknown as { [A in Accion]: Def<never> };
