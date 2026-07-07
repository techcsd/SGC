export type AusenciaTipo =
  | 'vacaciones'
  | 'enfermedad'
  | 'permiso_personal'
  | 'licencia_maternidad'
  | 'licencia_paternidad'
  | 'duelo'
  | 'no_remunerada';
export type AusenciaEstado = 'pendiente' | 'aprobada' | 'rechazada';

export interface SolicitudAusencia {
  id: string;
  empleado_id: string;
  empleado?: { nombre: string; apellido: string } | null;
  tipo: AusenciaTipo;
  fecha_inicio: string;
  fecha_fin: string;
  dias: number;
  motivo: string | null;
  estado: AusenciaEstado;
  solicitado_por: string;
  solicitante?: { nombre: string } | null;
  aprobado_por: string | null;
  aprobador?: { nombre: string } | null;
  comentario_aprobador: string | null;
  fecha_solicitud: string;
  fecha_resolucion: string | null;
}

export const AUSENCIA_TIPOS: { value: AusenciaTipo; label: string }[] = [
  { value: 'vacaciones', label: 'Vacaciones' },
  { value: 'enfermedad', label: 'Enfermedad' },
  { value: 'permiso_personal', label: 'Permiso personal' },
  { value: 'licencia_maternidad', label: 'Licencia de maternidad' },
  { value: 'licencia_paternidad', label: 'Licencia de paternidad' },
  { value: 'duelo', label: 'Duelo' },
  { value: 'no_remunerada', label: 'No remunerada' },
];

export const AUSENCIA_ESTADOS: { value: AusenciaEstado; label: string }[] = [
  { value: 'pendiente', label: 'Pendiente' },
  { value: 'aprobada', label: 'Aprobada' },
  { value: 'rechazada', label: 'Rechazada' },
];
