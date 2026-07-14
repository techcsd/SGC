export type ReporteTipo = 'comentario' | 'bug' | 'sugerencia';
export type ReporteEstado = 'abierto' | 'en_progreso' | 'resuelto' | 'descartado';

/** A photo attached to a user report (captured from the app, bucket `reportes`). */
export interface ReporteFoto {
  id: string;
  reporte_id: string;
  storage_path: string;
  created_at: string;
}

export interface ReporteUsuario {
  id: string;
  usuario_id: string;
  usuario?: { nombre: string; email: string };
  tipo: ReporteTipo;
  asunto: string;
  descripcion: string;
  estado: ReporteEstado;
  asignado_a: string | null;
  asignado?: { nombre: string } | null;
  respuesta_admin: string | null;
  created_at: string;
  updated_at: string;
  resuelto_en: string | null;
  fotos?: ReporteFoto[];
}

export const REPORTE_TIPO_LABELS: Record<ReporteTipo, string> = {
  comentario: 'Comentario',
  bug: 'Error / Bug',
  sugerencia: 'Sugerencia',
};

export const REPORTE_ESTADO_LABELS: Record<ReporteEstado, string> = {
  abierto: 'Abierto',
  en_progreso: 'En progreso',
  resuelto: 'Resuelto',
  descartado: 'Descartado',
};
