export interface DetalleEntrada {
  id: string;
  entrada_id: string;
  articulo_id: string;
  articulo?: { nombre: string; codigo: string; unidad: string };
  cantidad: number;
  precio_unit: number | null;
}

/** De dónde viene el material en una entrada de inventario. */
export type OrigenEntrada = 'compra' | 'devolucion_obra' | 'sobrante' | 'otro';

export interface EntradaInventario {
  id: string;
  fecha: string;
  bodega_id: string;
  bodega?: { nombre: string };
  proveedor_id: string | null;
  proveedor?: { nombre: string };
  orden_compra_id: string | null;
  orden_compra?: { numero: string };
  referencia: string | null;
  observaciones: string | null;
  creado_por: string | null;
  created_at: string;
  // Evidence photo captured by the mobile CSD app when the entrada was created.
  foto_path: string | null;
  // P12 — origen del material (devolución de obra enlaza la obra + la salida del traspaso).
  origen_tipo: OrigenEntrada | null;
  origen_proyecto_id: string | null;
  origen_proyecto?: { nombre: string } | null;
  salida_id: string | null;
  // T2 — dato de prueba (oculto a no-admin por RLS; admin lo marca/elimina).
  es_prueba?: boolean;
  detalle_entradas?: DetalleEntrada[];
}

export interface EntradaItemFormData {
  articulo_id: string;
  cantidad: number;
  precio_unit: number | null;
}

export interface EntradaFormData {
  fecha: string;
  bodega_id: string;
  proveedor_id: string | null;
  orden_compra_id: string | null;
  referencia: string | null;
  observaciones: string | null;
  items: EntradaItemFormData[];
  // P12 — origen del material. `descontar_origen` solo aplica a devolución de obra.
  origen_tipo?: OrigenEntrada | null;
  origen_proyecto_id?: string | null;
  descontar_origen?: boolean;
}
