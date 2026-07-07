export type TareaEstado = 'pendiente' | 'en_progreso' | 'completada' | 'cancelada';
export type TareaPrioridad = 'baja' | 'media' | 'alta' | 'urgente';

export interface Tarea {
  id: string;
  titulo: string;
  descripcion: string | null;
  estado: TareaEstado;
  prioridad: TareaPrioridad;
  asignado_a: string;
  asignado?: { nombre: string } | null;
  asignado_por: string;
  asignador?: { nombre: string } | null;
  proyecto_id: string | null;
  proyecto?: { nombre: string } | null;
  fecha_limite: string | null;
  fecha_completada: string | null;
  created_at: string;
}

export interface TareaComentario {
  id: string;
  tarea_id: string;
  usuario_id: string | null;
  usuario?: { nombre: string } | null;
  comentario: string;
  created_at: string;
}

export const TAREA_ESTADOS: { value: TareaEstado; label: string }[] = [
  { value: 'pendiente', label: 'Pendiente' },
  { value: 'en_progreso', label: 'En progreso' },
  { value: 'completada', label: 'Completada' },
  { value: 'cancelada', label: 'Cancelada' },
];

export const TAREA_PRIORIDADES: { value: TareaPrioridad; label: string }[] = [
  { value: 'baja', label: 'Baja' },
  { value: 'media', label: 'Media' },
  { value: 'alta', label: 'Alta' },
  { value: 'urgente', label: 'Urgente' },
];
