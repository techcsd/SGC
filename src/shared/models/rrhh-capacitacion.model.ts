// DN-27 P2 (ronda DN) — Capacitación: cursos/certificaciones del empleado,
// con vencimiento (ej. seguridad en obra). Permiso estándar.
export interface RrhhCapacitacion {
  id: string;
  empleado_id: string;
  curso: string;
  institucion: string | null;
  fecha_obtencion: string | null;
  fecha_vencimiento: string | null;
  archivo_path: string | null;
  created_at: string;
}
