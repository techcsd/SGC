export interface DetalleEntrada {
  id: string;
  entrada_id: string;
  articulo_id: string;
  articulo?: { nombre: string; codigo: string; unidad: string };
  cantidad: number;
  precio_unit: number | null;
}

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
}
