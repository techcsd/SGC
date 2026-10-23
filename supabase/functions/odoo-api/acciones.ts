// odoo-api/acciones.ts — allowlist cerrada de acciones de LECTURA contra Odoo.
// El navegador solo elige `accion` + parámetros tipados; modelo, método, dominio
// y campos los fija este archivo. Nada de dominio/modelo libre.
import type { OdooClient } from "../_shared/odoo-client.ts";

export class ParamError extends Error {}

export const ACCIONES = ["productos.buscar", "ubicaciones.listar", "stock.consultar"] as const;
export type Accion = typeof ACCIONES[number];

export const MAX_TAMANO = 100;
export const MAX_PAGINA = 10_000;

const idSeguro = (v: unknown, campo: string): number | null => {
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

export async function productosBuscar(odoo: OdooClient, p: Record<string, unknown>) {
  const termino = String(p.termino ?? "").trim();
  if (termino.length < 2 || termino.length > 80) throw new ParamError("El término de búsqueda debe tener entre 2 y 80 caracteres.");
  const limite = entero(p.limite, "limite", 20, 1, 50);
  const filas = await odoo.executeKw("product.product", "search_read", [[
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
}

export async function ubicacionesListar(odoo: OdooClient, _p: Record<string, unknown>) {
  const filas = await odoo.executeKw("stock.location", "search_read", [[
    ["usage", "=", "internal"], ["active", "=", true], ["company_id", "=", odoo.companyId],
  ]], { fields: ["id", "complete_name", "warehouse_id"], limit: 500, order: "complete_name asc" });
  return {
    ubicaciones: (filas as Record<string, unknown>[]).map((f) => ({
      id: f.id as number,
      nombre: String(f.complete_name ?? ""),
      almacen: m2o(f.warehouse_id)?.nombre ?? null,
    })),
  };
}

export async function stockConsultar(odoo: OdooClient, p: Record<string, unknown>) {
  const productoId = idSeguro(p.producto_id, "producto_id");
  const ubicacionId = idSeguro(p.ubicacion_id, "ubicacion_id");
  const pagina = entero(p.pagina, "pagina", 1, 1, MAX_PAGINA);
  const tamano = entero(p.tamano, "tamano", 25, 1, MAX_TAMANO);
  const dominio: unknown[] = [["location_id.usage", "=", "internal"], ["company_id", "=", odoo.companyId]];
  if (productoId) dominio.push(["product_id", "=", productoId]);
  if (ubicacionId) dominio.push(["location_id", "child_of", ubicacionId]);
  // Una sola llamada agrupada; pedimos tamano+1 para saber si hay otra página
  // sin una segunda consulta de conteo.
  const grupos = await odoo.executeKw("stock.quant", "read_group", [dominio, ["quantity:sum", "reserved_quantity:sum"], ["product_id", "location_id"]], {
    lazy: false, limit: tamano + 1, offset: (pagina - 1) * tamano, orderby: "product_id asc, location_id asc",
  }) as Record<string, unknown>[];
  const hayMas = grupos.length > tamano;
  return {
    pagina, tamano, hay_mas: hayMas,
    filas: grupos.slice(0, tamano).map((g) => {
      const fisica = Number(g.quantity ?? 0);
      const reservada = Number(g.reserved_quantity ?? 0);
      return {
        producto: m2o(g.product_id),
        ubicacion: m2o(g.location_id),
        cantidad_fisica: fisica,
        cantidad_reservada: reservada,
        cantidad_disponible: Math.round((fisica - reservada) * 1e6) / 1e6,
      };
    }),
  };
}

export const DESPACHO: Record<Accion, (odoo: OdooClient, p: Record<string, unknown>) => Promise<unknown>> = {
  "productos.buscar": productosBuscar,
  "ubicaciones.listar": ubicacionesListar,
  "stock.consultar": stockConsultar,
};
