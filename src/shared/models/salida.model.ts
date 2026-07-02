export interface DetalleSalida {
  id: string;
  salida_id: string;
  articulo_id: string;
  articulo?: { nombre: string; codigo: string; unidad: string };
  cantidad: number;
}

export interface SalidaInventario {
  id: string;
  fecha: string;
  bodega_id: string;
  bodega?: { nombre: string };
  proyecto_id: string | null;
  proyecto?: { nombre: string };
  motivo: string;
  responsable: string | null;
  observaciones: string | null;
  creado_por: string | null;
  created_at: string;
  detalle_salidas?: DetalleSalida[];
}

export interface SalidaItemFormData {
  articulo_id: string;
  cantidad: number;
}

export interface SalidaFormData {
  fecha: string;
  bodega_id: string;
  proyecto_id: string | null;
  motivo: string;
  responsable: string | null;
  observaciones: string | null;
  items: SalidaItemFormData[];
}

export const MOTIVOS_SALIDA: { value: string; label: string }[] = [
  { value: 'uso_proyecto', label: 'Uso en proyecto' },
  { value: 'venta', label: 'Venta' },
  { value: 'merma', label: 'Merma / Pérdida' },
  { value: 'devolucion', label: 'Devolución a proveedor' },
  { value: 'ajuste', label: 'Ajuste de inventario' },
  { value: 'otro', label: 'Otro' },
];
