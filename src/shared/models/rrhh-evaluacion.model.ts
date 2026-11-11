// DN-27 P2 (ronda DN) — Evaluaciones de desempeño. SENSIBLE (solo RRHH/Gerencia).
export interface RrhhEvaluacion {
  id: string;
  empleado_id: string;
  evaluador_id: string | null;
  periodo: string;
  puntaje: number | null;
  comentarios: string | null;
  created_at: string;
}
