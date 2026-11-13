// DN-27 P1 (ronda DN) — Reclutamiento (onboarding): vacantes + candidatos.
export type VacanteEstado = 'abierta' | 'pausada' | 'cerrada';
export type CandidatoEtapa = 'aplicado' | 'entrevista' | 'oferta' | 'contratado' | 'rechazado';

export interface RrhhVacante {
  id: string;
  titulo: string;
  departamento: string | null;
  descripcion: string | null;
  estado: VacanteEstado;
  creado_por: string | null;
  created_at: string;
}

export interface RrhhCandidato {
  id: string;
  vacante_id: string | null;
  nombre: string;
  telefono: string | null;
  email: string | null;
  cv_path: string | null;
  etapa: CandidatoEtapa;
  notas: string | null;
  empleado_id: string | null;
  creado_por: string | null;
  created_at: string;
  updated_at: string;
  // DO-05 — más datos de intake.
  experiencia_resumen: string | null;
  educacion: string | null;
  expectativa_salarial: number | null;
  fuente: string | null;
  telefono_alterno: string | null;
  // DO-06 — lo que la IA extrajo del CV (ver docs/DATOS-Y-TERCEROS.md: uso interno,
  // no se expone a Compa/MCP).
  cv_extraido: RrhhCandidatoCvExtraido | null;
  // DO-07 — archivado en vez de borrado físico.
  archivado: boolean;
  archivado_en: string | null;
  archivado_por: string | null;
}

/** DO-06 — campos que la IA extrae del CV (edge function rrhh-leer-cv). */
export interface RrhhCandidatoCvExtraido {
  nombre: string | null;
  telefono: string | null;
  email: string | null;
  experiencia_resumen: string | null;
  educacion: string | null;
  cargos_previos: string[] | null;
}

/** DO-05 — fila para la vista global "Candidatos" (join con la vacante). */
export interface RrhhCandidatoConVacante extends RrhhCandidato {
  vacante_titulo: string | null;
}

export const ETAPAS_ORDEN: CandidatoEtapa[] = ['aplicado', 'entrevista', 'oferta', 'contratado', 'rechazado'];
export const ETAPA_LABEL: Record<CandidatoEtapa, string> = {
  aplicado: 'Aplicó', entrevista: 'Entrevista', oferta: 'Oferta', contratado: 'Contratado', rechazado: 'Rechazado',
};
