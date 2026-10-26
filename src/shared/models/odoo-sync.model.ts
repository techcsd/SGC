// CY16 (#16) — bandeja de sincronización con Odoo, Tecnología. Solo lectura +
// reintento autorizado; nunca edita IDs/resultados desde el navegador.

export type OdooEventoEstado =
  | 'pendiente'
  | 'procesando'
  | 'completado'
  | 'reintento'
  | 'error'
  | 'incierto'
  | 'bloqueado'
  | 'cancelado';

export type OdooAgregadoTipo =
  | 'articulo'
  | 'categoria_inventario'
  | 'unidad'
  | 'proveedor'
  | 'entrada_inventario'
  | 'salida_inventario'
  | 'retiro_material'
  | 'solicitud_compra';

export interface OdooEventoFila {
  id: string;
  agregado_tipo: OdooAgregadoTipo;
  agregado_id: string;
  accion: 'crear' | 'actualizar';
  revision: number;
  estado: OdooEventoEstado;
  intentos: number;
  es_prueba: boolean;
  error: string | null;
  creado_en: string;
  actualizado_en: string;
}

export interface OdooIntentoRegistro {
  procesador: string;
  estado_resultado: 'completado' | 'reintento' | 'error' | 'incierto';
  resultado: Record<string, unknown> | null;
  error: string | null;
  reclamado_en: string;
  finalizado_en: string;
}

export interface OdooEventoDetalle {
  evento: OdooEventoFila & { payload: Record<string, unknown>; resultado: Record<string, unknown> | null };
  intentos: OdooIntentoRegistro[];
}

export interface OdooEventosResumenFila {
  agregado_tipo: OdooAgregadoTipo;
  estado: OdooEventoEstado;
  total: number;
}

export const ODOO_AGREGADO_LABEL: Record<OdooAgregadoTipo, string> = {
  articulo: 'Artículo',
  categoria_inventario: 'Categoría de inventario',
  unidad: 'Unidad',
  proveedor: 'Proveedor',
  entrada_inventario: 'Entrada de inventario',
  salida_inventario: 'Salida de inventario',
  retiro_material: 'Retiro de material',
  solicitud_compra: 'Solicitud de compra',
};

export const ODOO_ESTADO_LABEL: Record<OdooEventoEstado, string> = {
  pendiente: 'Pendiente',
  procesando: 'Procesando',
  completado: 'Sincronizado',
  reintento: 'Reintentando',
  error: 'Error',
  incierto: 'Necesita conciliación',
  bloqueado: 'Bloqueado',
  cancelado: 'Cancelado',
};
