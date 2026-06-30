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
  referencia: string | null;
  observaciones: string | null;
  creado_por: string | null;
  created_at: string;
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
  referencia: string | null;
  observaciones: string | null;
  items: EntradaItemFormData[];
}
