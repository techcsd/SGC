export type SolicitudMaterialEstado = 'pendiente' | 'aprobada' | 'rechazada' | 'entregada';
export type SolicitudCompraEstado = 'pendiente' | 'convertida' | 'rechazada';

export interface SolicitudMaterialItem {
  id: string;
  solicitud_id: string;
  articulo_id: string | null;
  descripcion: string;
  cantidad: number;
  unidad: string | null;
}

export interface SolicitudMaterial {
  id: string;
  proyecto_id: string;
  proyecto?: { nombre: string };
  solicitante_id: string;
  solicitante?: { nombre: string };
  estado: SolicitudMaterialEstado;
  urgencia: 'normal' | 'urgente';
  notas: string | null;
  salida_id: string | null;
  /** A2: solicitud de compra auto-generada por el faltante al aprobar. */
  solicitud_compra_id: string | null;
  /** A2: almacén desde el que se despachó la parte en stock. */
  bodega_id: string | null;
  atendido_por: string | null;
  atendido_en: string | null;
  created_at: string;
  items?: SolicitudMaterialItem[];
}

/** A2: resultado de aprobar_requisicion (auto-división despacho + compra). */
export interface AprobacionRequisicionResultado {
  salida_id: string | null;
  solicitud_compra_id: string | null;
  despachado_total: number;
  faltante_total: number;
}

export interface SolicitudMaterialFormData {
  proyecto_id: string;
  solicitante_id: string;
  urgencia: 'normal' | 'urgente';
  notas: string | null;
  items: { articulo_id: string | null; descripcion: string; cantidad: number; unidad: string | null }[];
}

export interface SolicitudCompraItem {
  id: string;
  solicitud_id: string;
  descripcion: string;
  cantidad: number;
  proveedor_sugerido: string | null;
}

export interface SolicitudCompra {
  id: string;
  proyecto_id: string;
  proyecto?: { nombre: string };
  solicitante_id: string;
  solicitante?: { nombre: string };
  estado: SolicitudCompraEstado;
  notas: string | null;
  orden_compra_id: string | null;
  /** A2: requisición que originó esta compra por faltante (si aplica). */
  origen_requisicion_id?: string | null;
  atendido_por: string | null;
  atendido_en: string | null;
  created_at: string;
  items?: SolicitudCompraItem[];
}

export interface SolicitudCompraFormData {
  proyecto_id: string;
  solicitante_id: string;
  notas: string | null;
  items: { descripcion: string; cantidad: number; proveedor_sugerido: string | null }[];
}
