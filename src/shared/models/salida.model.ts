export type MotivoSalida = 'uso_proyecto' | 'venta' | 'merma' | 'devolucion' | 'ajuste' | 'otro';

export interface SalidaInventario {
  id: string;
  articulo_id: string;
  articulo?: { nombre: string; codigo: string; unidad: string };
  bodega_id: string;
  bodega?: { nombre: string };
  cantidad: number;
  motivo: MotivoSalida;
  proyecto_referencia: string | null;
  fecha: string;
  referencia: string | null;
  notas: string | null;
  creado_por: string | null;
  created_at: string;
}

export interface SalidaFormData {
  articulo_id: string;
  bodega_id: string;
  cantidad: number;
  motivo: MotivoSalida;
  proyecto_referencia: string | null;
  fecha: string;
  referencia: string | null;
  notas: string | null;
}

export const MOTIVOS_SALIDA: { value: MotivoSalida; label: string }[] = [
  { value: 'uso_proyecto', label: 'Uso en proyecto' },
  { value: 'venta', label: 'Venta' },
  { value: 'merma', label: 'Merma / Pérdida' },
  { value: 'devolucion', label: 'Devolución a proveedor' },
  { value: 'ajuste', label: 'Ajuste de inventario' },
  { value: 'otro', label: 'Otro' },
];
