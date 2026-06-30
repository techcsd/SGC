export interface EntradaInventario {
  id: string;
  articulo_id: string;
  articulo?: { nombre: string; codigo: string; unidad: string };
  bodega_id: string;
  bodega?: { nombre: string };
  cantidad: number;
  costo_unitario: number | null;
  proveedor: string | null;
  motivo: string | null;
  fecha: string;
  referencia: string | null;
  creado_por: string | null;
  created_at: string;
}

export interface EntradaFormData {
  articulo_id: string;
  bodega_id: string;
  cantidad: number;
  costo_unitario: number | null;
  proveedor: string | null;
  motivo: string | null;
  fecha: string;
  referencia: string | null;
}
