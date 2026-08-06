export type TareaEstado = 'pendiente' | 'en_progreso' | 'completada' | 'cancelada';
export type TareaPrioridad = 'baja' | 'media' | 'alta' | 'urgente';
// AG15 — tipos de vínculo a entidades del sistema (tareas dinámicas).
export type TareaLinkedTipo = 'conduce' | 'ruta' | 'mantenimiento' | 'cronograma';

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
  proyecto?: { nombre: string; latitud: number | null; longitud: number | null } | null;
  fecha_limite: string | null;
  fecha_completada: string | null;
  // AG15 — vínculo dinámico a una entidad (conduce/ruta/mantenimiento/cronograma).
  linked_tipo?: TareaLinkedTipo | null;
  linked_id?: string | null;
  linked_params?: Record<string, unknown> | null;
  auto_completada?: boolean;
  // AG16 — plan del día: etiqueta de brigada/cuadrilla.
  brigada?: string | null;
  created_at: string;
}

export const TAREA_LINKED_TIPOS: { value: TareaLinkedTipo; label: string }[] = [
  { value: 'conduce', label: 'Conduce (compra + entrega en obra)' },
  { value: 'ruta', label: 'Ruta de transporte' },
  { value: 'mantenimiento', label: 'Mantenimiento de vehículo' },
  { value: 'cronograma', label: 'Tarea de cronograma de obra' },
];

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
