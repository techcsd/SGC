// PoC "Odoo como fuente de verdad" — contratos del gateway `odoo-api` (solo lectura).
// Los IDs de Odoo son enteros numéricos de ESA instancia; nunca son UUID de SGC ni
// se deben enviar a RPCs que esperan UUID.

/** ID nativo de Odoo: entero positivo seguro (Number.isSafeInteger). */
export type OdooId = number;

export interface OdooRef {
  id: OdooId;
  nombre: string;
}

export interface OdooProducto {
  id: OdooId;
  nombre: string;
  codigo: string | null;
  unidad: string | null;
  categoria: string | null;
}

export interface OdooUbicacion {
  id: OdooId;
  nombre: string;
  almacen: string | null;
}

export interface OdooStockFila {
  producto: OdooRef | null;
  ubicacion: OdooRef | null;
  cantidad_fisica: number;
  cantidad_reservada: number;
  cantidad_disponible: number;
}

export interface OdooStockPagina {
  pagina: number;
  tamano: number;
  hay_mas: boolean;
  filas: OdooStockFila[];
}

/** Sobre de respuesta del gateway: el dato + cuándo se leyó de Odoo y de dónde salió. */
export interface OdooRespuesta<T> {
  data: T;
  /** ISO-8601: momento real de la lectura en Odoo (no el de la petición, si vino de caché). */
  consultado_en: string;
  /** miss = leído ahora; hit = caché del gateway; inflight = compartió una lectura en vuelo; refresh = forzado. */
  cache: 'miss' | 'hit' | 'inflight' | 'refresh';
}

export interface OdooUbicaciones {
  ubicaciones: OdooUbicacion[];
  /** true si Odoo tiene más ubicaciones que las devueltas (lista truncada). */
  truncado: boolean;
}

export interface OdooStockFiltro {
  producto_id?: OdooId | null;
  ubicacion_id?: OdooId | null;
  pagina?: number;
  tamano?: number;
  /** Salta el caché del gateway (botón "Actualizar"). */
  refrescar?: boolean;
}

/** Acciones permitidas del gateway (espejo de la allowlist del servidor). */
export type OdooAccion = 'productos.buscar' | 'ubicaciones.listar' | 'stock.consultar';

/** ¿Es un ID de Odoo válido? (entero positivo seguro). */
export function esOdooId(v: unknown): v is OdooId {
  return typeof v === 'number' && Number.isSafeInteger(v) && v > 0;
}
