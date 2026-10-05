// X6 — tipos de visita a taller (+ AC14.3 equipos: engrase / hidráulico; AG9: otros).
export type MantenimientoTipo =
  | 'preventivo'
  | 'falla'
  | 'accidente_dano'
  | 'cambio_pieza'
  | 'engrase'
  | 'hidraulico'
  | 'otros';
export type MantenimientoEstado = 'pendiente' | 'en_proceso' | 'completado';

// CG13 — adjunto (imagen o PDF) de un mantenimiento, en la tabla
// `sgc.mantenimiento_adjuntos` (bucket `vehiculos`). Convive con el legacy `fotos[]`.
export interface MantenimientoAdjunto {
  id: string;
  path: string;
  nombre: string;
  mime: string;
  tipo_documento: string;
}

// CG13 — tipos de documento para los adjuntos del mantenimiento.
export const MANT_ADJUNTO_TIPOS: { value: string; label: string }[] = [
  { value: 'factura', label: 'Factura' },
  { value: 'informe', label: 'Informe del taller' },
  { value: 'cotizacion', label: 'Cotización' },
  { value: 'garantia', label: 'Garantía' },
  { value: 'foto', label: 'Foto' },
  { value: 'otro', label: 'Otro' },
];

export interface Mantenimiento {
  id: string;
  vehiculo_id: string;
  vehiculo?: { placa: string; marca: string; modelo: string };
  tipo: MantenimientoTipo;
  descripcion: string;
  fecha: string;
  costo: number | null;
  kilometraje_al_mantenimiento: number | null;
  proveedor: string | null;
  estado: MantenimientoEstado;
  notas: string | null;
  fotos?: string[];
  // CG13 — adjuntos (imágenes + PDFs) del nuevo esquema `mantenimiento_adjuntos`.
  adjuntos?: MantenimientoAdjunto[];
  es_prueba?: boolean;
  incluye_preventivo?: boolean;
  accidente_id?: string | null;
  created_at: string;
  // AB3 — quién lo registró (default auth.uid() en el insert; NULL en históricos).
  creado_por?: string | null;
  creado_por_usuario?: { nombre: string } | null;
}

export interface MantenimientoFormData {
  vehiculo_id: string;
  tipo: MantenimientoTipo;
  descripcion: string;
  fecha: string;
  costo: number | null;
  kilometraje_al_mantenimiento: number | null;
  proveedor: string | null;
  estado: MantenimientoEstado;
  notas: string | null;
  incluye_preventivo?: boolean;
  accidente_id?: string | null;
}

export const MANT_TIPOS: { value: MantenimientoTipo; label: string }[] = [
  { value: 'preventivo', label: 'Mantenimiento preventivo' },
  { value: 'falla', label: 'Reparación por falla/avería' },
  { value: 'accidente_dano', label: 'Reparación por accidente/daño' },
  { value: 'cambio_pieza', label: 'Cambio de pieza/consumible' },
  // AC14.3 — visitas propias de equipos por horas (telehandler, etc.).
  { value: 'engrase', label: 'Engrase' },
  { value: 'hidraulico', label: 'Servicio hidráulico' },
  // AG9 — servicios que no son mantenimiento clásico (tintado, lavado, etc.).
  { value: 'otros', label: 'Otros servicios' },
];

/** Badge por tipo de visita (color) para listados/detalle. */
export const MANT_TIPO_BADGE: Record<MantenimientoTipo, string> = {
  preventivo: 'success',
  falla: 'warning',
  accidente_dano: 'danger',
  cambio_pieza: 'info',
  engrase: 'neutral',
  hidraulico: 'info',
  otros: 'neutral',
};

export const MANT_ESTADOS = [
  { value: 'pendiente', label: 'Pendiente' },
  { value: 'en_proceso', label: 'En proceso' },
  { value: 'completado', label: 'Completado' },
];
