export type OrdenEstado = 'borrador' | 'aprobada' | 'recibida' | 'cancelada';

export interface OrdenCompraItem {
  id?: string;
  orden_id?: string;
  articulo_id: string | null;
  descripcion: string;
  cantidad: number;
  precio_unitario: number;
  total: number;
}

export interface OrdenCompra {
  id: string;
  numero: string;
  proveedor_id: string;
  proveedor?: { nombre: string };
  estado: OrdenEstado;
  fecha: string;
  fecha_entrega_esperada: string | null;
  subtotal: number;
  impuesto: number;
  total: number;
  notas: string | null;
  items?: OrdenCompraItem[];
  created_at: string;
}
