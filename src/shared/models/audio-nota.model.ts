// Z23c — Notas de voz transversales (tabla genérica sgc.audio_notas).
// El mismo contrato sirve para incidentes, reporte semanal, pre-uso,
// mantenimiento, rutas, etc. La bitácora conserva su propio adjunto
// (bitacora_archivos) por retrocompatibilidad.

export type AudioEntidadTipo =
  | 'bitacora'
  | 'incidente'
  | 'accidente'
  | 'reporte_semanal'
  | 'preuso'
  | 'mantenimiento'
  | 'ruta'
  | 'checklist'
  | 'otro';

/** Fila devuelta por el RPC `audios_de(entidad_tipo, entidad_id)`. */
export interface AudioNota {
  id: string;
  bucket: string;
  path: string;
  duracion_seg: number | null;
  tipo_mime: string | null;
  tamano_bytes: number | null;
  es_prueba: boolean;
  creado_por: string | null;
  created_at: string;
}

/** Límite por defecto de notas de voz por registro (coincide con el RPC). */
export const MAX_AUDIO_NOTAS = 5;
