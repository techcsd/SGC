export type SalidaEstado = 'despachado' | 'entregado' | 'entregado_incompleto';

export const SALIDA_ESTADO_LABELS: Record<SalidaEstado, string> = {
  despachado: 'Despachado',
  entregado: 'Entregado',
  entregado_incompleto: 'Entregado (incompleto)',
};

export interface DetalleSalida {
  id: string;
  salida_id: string;
  articulo_id: string;
  articulo?: { nombre: string; codigo: string; unidad: string };
  cantidad: number;
  cantidad_recibida: number | null;
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
  estado: SalidaEstado;
  conductor_id: string | null;
  conductor?: { nombre: string } | null;
  vehiculo_id: string | null;
  vehiculo?: { placa: string } | null;
  recibido_por: string | null;
  recibido?: { nombre: string } | null;
  recibido_en: string | null;
  notas_recepcion: string | null;
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
  conductor_id: string | null;
  vehiculo_id: string | null;
  items: SalidaItemFormData[];
}

/** Human-facing conduce number derived from the salida id — single source of
 *  truth so the list, the printable view, and any export all agree. */
export function conduceNumero(salidaId: string): string {
  return 'CND-' + salidaId.slice(0, 8).toUpperCase();
}

export const MOTIVOS_SALIDA: { value: string; label: string }[] = [
  { value: 'uso_proyecto', label: 'Uso en proyecto' },
  { value: 'venta', label: 'Venta' },
  { value: 'merma', label: 'Merma / Pérdida' },
  { value: 'devolucion', label: 'Devolución a proveedor' },
  { value: 'ajuste', label: 'Ajuste de inventario' },
  { value: 'otro', label: 'Otro' },
];
