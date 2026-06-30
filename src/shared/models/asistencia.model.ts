export type EstadoAsistencia = 'presente' | 'ausente' | 'tardanza' | 'permiso' | 'feriado';

export interface Asistencia {
  id: string;
  empleado_id: string;
  empleado?: { nombre: string; apellido: string; cargo: string };
  fecha: string;
  hora_entrada: string | null;
  hora_salida: string | null;
  estado: EstadoAsistencia;
  notas: string | null;
  created_at: string;
}

export interface AsistenciaFormData {
  empleado_id: string;
  fecha: string;
  hora_entrada: string | null;
  hora_salida: string | null;
  estado: EstadoAsistencia;
  notas: string | null;
}

export const ESTADOS_ASISTENCIA = [
  { value: 'presente', label: 'Presente', badge: 'success' },
  { value: 'ausente', label: 'Ausente', badge: 'danger' },
  { value: 'tardanza', label: 'Tardanza', badge: 'warning' },
  { value: 'permiso', label: 'Permiso', badge: 'info' },
  { value: 'feriado', label: 'Feriado', badge: 'neutral' },
];
