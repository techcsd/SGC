export type SolicitudMaterialEstado =
  | 'pendiente'
  | 'aprobada'
  | 'rechazada'
  | 'entregada'
  | 'cerrada'
  // BA / Transporte v3 — despachos
  | 'por_despachar'
  | 'parcial'
  | 'completada'
  | 'cancelada';
export type SolicitudCompraEstado = 'pendiente' | 'convertida' | 'rechazada';

export interface SolicitudMaterialItem {
  id: string;
  solicitud_id: string;
  articulo_id: string | null;
  descripcion: string;
  cantidad: number;
  unidad: string | null;
  /** Talla indicada (obligatoria para EPP con requiere_talla). */
  talla?: string | null;
}

export interface SolicitudMaterial {
  id: string;
  /** BC4 — folio secuencial legible; se muestra como código REQ-XXXXXX. */
  folio?: number | null;
  proyecto_id: string;
  proyecto?: { nombre: string };
  solicitante_id: string;
  // BC4 — el solicitante trae sus roles para mostrar "Nombre · Rol".
  solicitante?: { nombre: string; roles?: { rol: { codigo: string; nombre: string } | null }[] };
  estado: SolicitudMaterialEstado;
  urgencia: 'normal' | 'urgente';
  notas: string | null;
  salida_id: string | null;
  /** A2: solicitud de compra auto-generada por el faltante al aprobar. */
  solicitud_compra_id: string | null;
  /** A2: almacén desde el que se despachó la parte en stock. */
  bodega_id: string | null;
  atendido_por: string | null;
  /** Nombre del atendedor — solo presente si el SELECT hace el join (opcional). */
  atendido?: { nombre: string } | null;
  atendido_en: string | null;
  created_at: string;
  // BB10 — versión: sube en cada edición del autor mientras está pendiente.
  version?: number | null;
  // BF6 — motivo del rechazo (campo propio, ya no pisa `notas`). Visible al autor.
  motivo_rechazo?: string | null;
  /** BF6 — nombre del solicitante resuelto por directorio (bypassa RLS de usuarios). */
  solicitante_nombre_dir?: string | null;
  // BA6 — cancelación/cierre: motivo + quién + cuándo.
  cancelada_motivo?: string | null;
  cerrada_por?: string | null;
  cerrada_en?: string | null;
  /** Nombre de quien canceló/cerró — solo si el SELECT hace el join (opcional). */
  cerrada?: { nombre: string } | null;
  items?: SolicitudMaterialItem[];
}

/** BC4 — código citable de la requisición (REQ-XXXXXX) a partir del folio. */
export function requisicionCodigo(s: Pick<SolicitudMaterial, 'folio'>): string {
  return s.folio != null ? 'REQ-' + String(s.folio).padStart(6, '0') : '—';
}

/** BC4 — etiqueta de rol(es) del solicitante ("Ingeniero de campo") o '' si no hay. */
export function solicitanteRolLabel(s: Pick<SolicitudMaterial, 'solicitante'>): string {
  return (s.solicitante?.roles ?? [])
    .map((r) => r.rol?.nombre)
    .filter((n): n is string => !!n)
    .join(', ');
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
  items: {
    articulo_id: string | null;
    descripcion: string;
    cantidad: number;
    unidad: string | null;
    talla?: string | null;
  }[];
}

export interface SolicitudCompraItem {
  id: string;
  solicitud_id: string;
  descripcion: string;
  cantidad: number;
  proveedor_sugerido: string | null;
  foto_path?: string | null; // U17 — foto del renglón (bucket `inventario`)
  /** BH7 — artículo del catálogo cuando el faltante nació de un renglón resuelto. */
  articulo_id?: string | null;
  unidad?: string | null;
  /** BH7 — renglón de la requisición que originó este faltante. */
  origen_item_id?: string | null;
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
  /** BH7 — folio de la requisición de procedencia (embed), para pintar REQ-XXXXXX. */
  origen?: { folio: number | null } | null;
  /** A7: categoría de la compra (p.ej. 'tecnologia'). */
  categoria?: string | null;
  atendido_por: string | null;
  /** Nombre del atendedor — solo presente si el SELECT hace el join (opcional). */
  atendido?: { nombre: string } | null;
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
