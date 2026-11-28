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
  unidad_id?: OdooId | null;
  categoria: string | null;
  categoria_id?: OdooId | null;
  plantilla_id?: OdooId | null;
  /** Existencia viva en la bodega elegida (solo modo inventario). */
  disponible?: number | null;
}

/** CY24 (#24, D1) — variante "compras" de OdooProducto: filtra por purchase_ok
 *  en vez de type='product', y trae la UoM de compra (nombre + id numérico —
 *  el id es lo que se persiste en orden_compra_items.odoo_uom_id). */
export interface OdooProductoCompra extends OdooProducto {
  unidad_compra: string | null;
  unidad_compra_id: OdooId | null;
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
export type OdooAccion = 'productos.buscar' | 'productos.listar' | 'categorias.listar' | 'unidades.listar' | 'ubicaciones.listar' | 'stock.consultar' | 'almacenes.listar' | 'stock.disponible' | 'stock.disponible_bodega' | 'stock.disponible_productos' | 'stock.validar_salida' | 'salidas.emitir' | 'productos.buscar_compra' | 'compras.obtener_varias' | 'proveedores.buscar' | 'proveedores.obtener_varios';

/** CY24 Fase C — acciones de ESCRITURA del gateway (módulo `compras`; el cliente solo manda `orden_id`, D5). */
export type OdooAccionEscritura = 'compras.crear' | 'compras.confirmar' | 'compras.cancelar' | 'proveedores.crear' | 'proveedores.actualizar' | 'productos.crear';

/** Resultado de una escritura de OC; `repetido` = el comando ya estaba completado (idempotencia, D3). */
export interface OdooComandoOcResultado {
  modelo: string;
  odoo_id: OdooId;
  nombre?: string;
  estado_odoo: string;
  /** Total que armó Odoo (solo informativo: SGC no lo calcula ni lo compara). */
  total?: number | null;
  repetido: boolean;
}

/** Proveedor leído de Odoo (res.partner). Es la fuente de nombre, RNC, contacto fiscal y estado. */
export interface OdooProveedor {
  id: OdooId;
  nombre: string;
  rnc: string | null;
  email: string | null;
  telefono: string | null;
  direccion: string | null;
  activo: boolean;
  es_empresa: boolean;
}

export interface OdooProveedoresPagina {
  proveedores: OdooProveedor[];
  pagina: number;
  tamano: number;
  hay_mas: boolean;
}

/** Campos fiscales/maestros que se escriben en Odoo (el resto del proveedor es operativo y vive en SGC). */
export interface OdooProveedorEscritura {
  nombre?: string;
  rnc?: string | null;
  email?: string | null;
  telefono?: string | null;
  direccion?: string | null;
  activo?: boolean;
}

/** Estado VIVO de una OC leído de Odoo (`compras.obtener_varias`). SGC no lo guarda: se pide cada vez. */
export interface OdooOcVivo {
  id: OdooId;
  nombre: string;
  /** state de purchase.order: draft | sent | to approve | purchase | done | cancel. */
  estado: string;
  total: number | null;
  moneda: string | null;
  recibida_en_odoo: boolean;
  recepciones_hechas: number;
  recepciones_total: number;
}

/** ¿Es un ID de Odoo válido? (entero positivo seguro). */
export function esOdooId(v: unknown): v is OdooId {
  return typeof v === 'number' && Number.isSafeInteger(v) && v > 0;
}


/** #202 — almacén de Odoo (stock.warehouse) con su ubicación de existencias. */
export interface OdooAlmacen {
  id: OdooId;
  codigo: string;
  nombre: string;
  location_id: OdooId | null;
}

export interface OdooStockDisponibleFila {
  articulo_id: string;
  nombre: string;
  odoo_product_id: OdooId | null;
  disponible: number;
}

export interface OdooStockDisponibleBodega {
  origen: 'odoo' | 'sgc';
  fuente_odoo: boolean;
  homologada: boolean;
  contingencia: boolean;
  consultado_en: string | null;
  almacen?: { nombre: string; codigo_odoo: string | null; location_id: OdooId | null; warehouse_id: OdooId | null };
  filas: OdooStockDisponibleFila[];
}

export interface OdooFaltanteStock {
  productId: number;
  pedido: number;
  disponible: number;
  nombre: string;
  articulo_id?: string;
}

export interface OdooSalidaEmitida {
  salida_id: string;
  validacion: 'odoo' | 'sgc' | 'prueba';
  aviso: string | null;
  consultado_en: string | null;
}

export interface OdooProductoInventario extends OdooProducto {
  disponible: number | null;
  consultado_en?: string | null;
}

export interface OdooProductoInventarioSeleccionado {
  articuloId: string;
  creado: boolean;
  producto: OdooProductoInventario;
}

export interface OdooCatalogoPagina {
  productos: OdooProducto[];
  pagina: number;
  tamano: number;
  hay_mas: boolean;
}

export interface OdooCategoria {
  id: OdooId;
  nombre: string;
  nombre_completo: string;
  padre_id: OdooId | null;
}

export interface OdooUnidad {
  id: OdooId;
  nombre: string;
  // Odoo 19: uom.uom ya no tiene categoría ni tipo; cada unidad se define respecto a otra (relative_uom_id).
  relativa_a?: string | null;
  factor: number;
  factor_relativo?: number;
}

export interface OdooStockProductoFila {
  producto_id: OdooId;
  disponible: number;
  fisica: number;
  reservada: number;
}

export interface OdooStockProductosBodega {
  origen: 'odoo' | 'sgc';
  fuente_odoo: boolean;
  homologada: boolean;
  contingencia: boolean;
  consultado_en: string | null;
  filas: OdooStockProductoFila[];
}

export interface OdooProductoCreado {
  producto: { id: OdooId; nombre: string; codigo: string | null; yaExistia?: boolean };
  articulo_id: string;
  repetido: boolean;
}
