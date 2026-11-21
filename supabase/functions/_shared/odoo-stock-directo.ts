// _shared/odoo-stock-directo.ts — #202: existencias y almacenes se leen DIRECTO de Odoo
// al emitir un conduce (deja de usarse stock_por_bodega de SGC como autoridad).
// Lecturas: stock.warehouse + stock.quant (disponible = quantity - reserved_quantity).
// Reutiliza faltantesDeStock / disponibilidadPorProducto de odoo-traslados.ts.
import { OdooError } from "./odoo-client.ts";
import { faltantesDeStock, type FaltanteStock, type LlamadorOdoo } from "./odoo-traslados.ts";

export type CodigoConduceStock = "sin_stock" | "no_homologado" | "odoo_caido" | "datos";

/** Error de negocio al validar/emitir un conduce contra Odoo. El mensaje es apto para el usuario. */
export class ConduceStockError extends Error {
  constructor(
    public codigo: CodigoConduceStock,
    message: string,
    public faltantes: FaltanteEnriquecido[] = [],
    public extra: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "ConduceStockError";
  }
}

export interface FaltanteEnriquecido extends FaltanteStock {
  articulo_id?: string;
  nombre: string;
}

export interface AlmacenOdoo {
  warehouse_id: number;
  codigo: string;
  nombre: string;
  location_id: number | null;
}

const r6 = (n: number) => Math.round(n * 1e6) / 1e6;

/** Lista almacenes internos de la compañía (stock.warehouse + ubicación de existencias). */
export async function listarAlmacenesOdoo(c: LlamadorOdoo, companyId: number): Promise<AlmacenOdoo[]> {
  const filas = await c.call("stock.warehouse", "search_read", [[
    ["active", "=", true],
    "|", ["company_id", "=", false], ["company_id", "=", companyId],
  ]], { fields: ["id", "code", "name", "lot_stock_id"], order: "name asc", limit: 200 }) as Record<string, unknown>[];
  return (filas ?? []).map((f) => ({
    warehouse_id: f.id as number,
    codigo: String(f.code ?? ""),
    nombre: String(f.name ?? ""),
    location_id: Array.isArray(f.lot_stock_id) && typeof f.lot_stock_id[0] === "number" ? f.lot_stock_id[0] : null,
  }));
}

export function mensajeFaltantes(faltantes: FaltanteEnriquecido[]): string {
  const lineas = faltantes.map((f) =>
    `${f.nombre}: solicitado ${trimNum(f.pedido)}, disponible ${trimNum(f.disponible)}`,
  );
  return `No hay existencias suficientes en el almacén de origen. ${lineas.join("; ")}.`;
}

function trimNum(n: number): string {
  const s = r6(n).toFixed(6).replace(/\.?0+$/, "");
  return s === "-0" ? "0" : s;
}

export function enriquecerFaltantes(
  faltantes: FaltanteStock[],
  nombres: Map<number, { nombre: string; articulo_id?: string }>,
): FaltanteEnriquecido[] {
  return faltantes.map((f) => ({
    ...f,
    pedido: r6(f.pedido),
    disponible: r6(f.disponible),
    nombre: nombres.get(f.productId)?.nombre ?? `producto ${f.productId}`,
    articulo_id: nombres.get(f.productId)?.articulo_id,
  }));
}

/** ¿El fallo es de transporte/caída (Odoo no respondió), no un rechazo de negocio? */
export function esOdooCaido(e: unknown): boolean {
  return e instanceof OdooError && (e.codigo === "odoo_timeout" || e.codigo === "odoo_no_disponible" ||
    e.codigo === "odoo_circuito_abierto" || e.codigo === "odoo_saturado" || e.codigo === "odoo_auth" ||
    e.codigo === "odoo_config");
}

/** Fallback a stock SGC solo con contingencia de almacén o el interruptor de emergencia. */
export function fallbackSgcHabilitado(env: (k: string) => string | undefined = (k) => Deno.env.get(k)): boolean {
  return env("ODOO_CONDUCE_FALLBACK_SGC") === "true";
}

export const MENSAJE_ODOO_CAIDO =
  "No se puede emitir el conduce porque Odoo no responde. Espera un momento e inténtalo de nuevo.";

export const MENSAJE_FALLBACK_SGC =
  "Odoo no responde. Se usará el stock local de SGC porque hay una contingencia vigente o el interruptor de emergencia está encendido.";

export interface ItemSalidaValidar {
  articulo_id: string;
  cantidad: number;
  nombre?: string;
  odoo_product_id?: number | null;
}

export async function validarStockOdoo(
  c: LlamadorOdoo,
  locationId: number,
  items: ItemSalidaValidar[],
): Promise<FaltanteEnriquecido[]> {
  const conProducto = items.filter((i) => i.odoo_product_id && i.cantidad > 0);
  if (conProducto.length === 0) return [];
  const nombres = new Map<number, { nombre: string; articulo_id?: string }>();
  const pedido: Array<{ productId: number; cantidad: number }> = [];
  for (const i of conProducto) {
    const id = i.odoo_product_id!;
    nombres.set(id, { nombre: i.nombre ?? `artículo`, articulo_id: i.articulo_id });
    pedido.push({ productId: id, cantidad: i.cantidad });
  }
  const falta = await faltantesDeStock(c, locationId, pedido);
  return enriquecerFaltantes(falta, nombres);
}

export const MAX_ITEMS_VALIDAR = 100;
export const MAX_ARTICULOS_DISPONIBLE = 500;
