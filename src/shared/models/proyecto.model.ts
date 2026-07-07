export type ProyectoEstado = 'planificacion' | 'en_progreso' | 'pausado' | 'completado' | 'cancelado';
export type ProyectoTipo = 'residencial' | 'comercial' | 'industrial' | 'infraestructura' | 'otro';

export interface Proyecto {
  id: string;
  codigo: string;
  nombre: string;
  cliente: string | null;
  tipo: ProyectoTipo | null;
  estado: ProyectoEstado;
  fecha_inicio: string | null;
  fecha_fin_estimada: string | null;
  fecha_fin_real: string | null;
  presupuesto: number | null;
  ubicacion: string | null;
  localidad: string | null;
  descripcion: string | null;
  responsable_id: string | null;
  responsable?: { nombre: string };
  activo: boolean;
  created_at: string;
  fases?: FaseProyecto[];
}

export interface ProyectoEmpleado {
  id: string;
  proyecto_id: string;
  empleado_id: string;
  empleado?: { nombre: string; apellido: string; cargo: string };
  rol: string | null;
  created_at: string;
}

export interface FaseProyecto {
  id: string;
  proyecto_id: string;
  nombre: string;
  descripcion: string | null;
  estado: 'pendiente' | 'en_progreso' | 'completada';
  fecha_inicio: string | null;
  fecha_fin: string | null;
  progreso: number;
  orden: number;
}

export const PROYECTO_ESTADOS = [
  { value: 'planificacion', label: 'Planificación', badge: 'neutral' },
  { value: 'en_progreso', label: 'En progreso', badge: 'info' },
  { value: 'pausado', label: 'Pausado', badge: 'warning' },
  { value: 'completado', label: 'Completado', badge: 'success' },
  { value: 'cancelado', label: 'Cancelado', badge: 'danger' },
];

export const PROYECTO_TIPOS = [
  { value: 'residencial', label: 'Residencial' },
  { value: 'comercial', label: 'Comercial' },
  { value: 'industrial', label: 'Industrial' },
  { value: 'infraestructura', label: 'Infraestructura' },
  { value: 'otro', label: 'Otro' },
];

export const FASE_ESTADOS = [
  { value: 'pendiente', label: 'Pendiente', badge: 'neutral' },
  { value: 'en_progreso', label: 'En progreso', badge: 'info' },
  { value: 'completada', label: 'Completada', badge: 'success' },
];

// Suggested roles for project team members (datalist — keeps labels consistent).
export const ROLES_PROYECTO = [
  'Encargado de obra',
  'Ingeniero residente',
  'Maestro constructor',
  'Supervisor',
  'Capataz',
  'Topógrafo',
  'Administrativo de obra',
  'Seguridad',
];
