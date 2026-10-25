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
// CO8 — se amplía con los estados del flujo nuevo de Compras tecnológicas
// (borrador/esperando_aprobacion/aprobada/comprada); el flujo normal de Compras
// sigue usando solo pendiente/convertida/rechazada.
export type SolicitudCompraEstado =
  | 'pendiente' | 'convertida' | 'rechazada'
  | 'borrador' | 'esperando_aprobacion' | 'aprobada' | 'comprada';

export interface SolicitudMaterialItem {
  id: string;
  solicitud_id: string;
  articulo_id: string | null;
  descripcion: string;
  cantidad: number; // BM5 — SIEMPRE en unidad base.
  unidad: string | null;
  /** Talla indicada (obligatoria para EPP con requiere_talla). */
  talla?: string | null;
  /** BM5 — unidad capturada (ej. 'atado') + su factor; cantidad en base. */
  unidad_capturada?: string | null;
  factor_aplicado?: number | null;
  /** CJ7 — artículo del catálogo elegido al APROBAR/DESPACHAR un renglón LIBRE
   *  (distinto de `articulo_id`, que es el que trae el renglón desde el origen). */
  articulo_despacho_id?: string | null;
  /** CX3.4 — nombre embebido de `articulo_id` (si el renglón ya traía catálogo). */
  articulo?: { nombre: string } | null;
  /** CX3.4 — nombre embebido de `articulo_despacho_id` (si se resolvió al aprobar). */
  articulo_despacho?: { nombre: string } | null;
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
  /** BO8 — fecha para cuándo se necesita el material (prioridad real de obra). Nullable. */
  fecha_necesidad?: string | null;
  /** BV9 — fase derivada por el servidor (columna computada requisicion_fase). */
  fase?: 'pendiente' | 'en_proceso' | 'completada' | 'rechazada' | null;
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
  /** CO4 — true cuando el propio autor la aprobó con el permiso requisicion_autoaprobar. */
  autoaprobada?: boolean | null;
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
  /** BO8 — fecha de necesidad (opcional). */
  fecha_necesidad?: string | null;
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
  /** CO8 — precio unitario (compras tecnológicas). */
  precio_unitario?: number | null;
}

/** CO8 — estados del flujo de Compras tecnológicas (categoria='tecnologia'). */
export type SolicitudCompraTecEstado =
  | 'borrador' | 'esperando_aprobacion' | 'aprobada' | 'rechazada' | 'comprada';

/** CQ1 — lo que la edge `leer-cotizacion` extrajo del PDF/foto (revisable, nunca autoritativo). */
export interface LecturaCotizacionArticulo {
  descripcion: string;
  cantidad: number | null;
  unidad: string | null;
  precio: number | null;
}
export interface LecturaCotizacion {
  proveedor: string | null;
  fecha: string | null;
  moneda: string | null;
  articulos: LecturaCotizacionArticulo[];
  itbis: number | null;
  total: number | null;
}

export interface SolicitudCompraAdjunto {
  id: string;
  solicitud_id: string;
  tipo: 'cotizacion' | 'factura' | 'otro';
  proveedor: string | null;
  monto: number | null;
  path: string;
  nombre: string;
  elegida: boolean;
  subido_por: string | null;
  created_at: string;
  /** CQ1 — fecha de la cotización (si se leyó o la indicó el usuario). */
  fecha?: string | null;
  /** CQ1 — lo que devolvió la lectura automática (IA), tal cual, para auditoría. */
  lectura?: LecturaCotizacion | null;
  /** CQ1 — costo estimado (USD) de la lectura con IA de ESTE adjunto. */
  lectura_costo_usd?: number | null;
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
  // CO8 — flujo de Compras tecnológicas.
  aprobador_id?: string | null;
  aprobador?: { nombre: string } | null;
  enviada_at?: string | null;
  decidida_por?: string | null;
  decidida?: { nombre: string } | null;
  decidida_at?: string | null;
  motivo_rechazo?: string | null;
  adjuntos?: SolicitudCompraAdjunto[];
  // CQ1 — rediseño de alta: encabezado + ITBIS calculado en servidor.
  titulo?: string | null;
  urgencia?: 'normal' | 'urgente' | null;
  itbis_incluido?: boolean | null;
  subtotal?: number | null;
  itbis?: number | null;
  total?: number | null;
}

export interface SolicitudCompraFormData {
  proyecto_id: string;
  solicitante_id: string;
  notas: string | null;
  items: { descripcion: string; cantidad: number; proveedor_sugerido: string | null }[];
}
