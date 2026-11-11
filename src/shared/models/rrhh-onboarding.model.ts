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
}

export const ETAPAS_ORDEN: CandidatoEtapa[] = ['aplicado', 'entrevista', 'oferta', 'contratado', 'rechazado'];
export const ETAPA_LABEL: Record<CandidatoEtapa, string> = {
  aplicado: 'Aplicó', entrevista: 'Entrevista', oferta: 'Oferta', contratado: 'Contratado', rechazado: 'Rechazado',
};
