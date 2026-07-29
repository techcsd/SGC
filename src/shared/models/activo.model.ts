export type ActivoEstado = 'activo' | 'mantenimiento' | 'baja';

// Y8 — a qué entidad se relaciona/asigna el activo (una sola a la vez).
export type ActivoAsignadoTipo = 'proyecto' | 'empleado' | 'ingeniero' | 'almacen' | 'vehiculo';

export interface ActivoFijo {
  id: string;
  codigo: string;
  nombre: string;
  descripcion: string | null;
  categoria_id: number | null;
  categoria?: { nombre: string };
  valor_adquisicion: number;
  fecha_adquisicion: string;
  vida_util_anios: number | null;
  estado: ActivoEstado;
  ubicacion: string | null;
  responsable_id: string | null;
  responsable?: { nombre: string };
  // Y8 — relación polimórfica a obra/empleado/ingeniero/almacén/vehículo.
  asignado_tipo: ActivoAsignadoTipo | null;
  asignado_id: string | null;
  notas: string | null;
  activo: boolean;
  es_prueba?: boolean;
  created_at: string;
}

export interface ActivoFormData {
  codigo?: string;
  nombre: string;
  descripcion: string | null;
  categoria_id: number | null;
  valor_adquisicion: number;
  fecha_adquisicion: string;
  vida_util_anios: number | null;
  estado: ActivoEstado;
  ubicacion: string | null;
  asignado_tipo: ActivoAsignadoTipo | null;
  asignado_id: string | null;
  notas: string | null;
  activo: boolean;
  es_prueba?: boolean;
}

export const ACTIVO_ESTADOS: { value: ActivoEstado; label: string }[] = [
  { value: 'activo', label: 'Activo' },
  { value: 'mantenimiento', label: 'En mantenimiento' },
  { value: 'baja', label: 'Dado de baja' },
];

// Y8 — tipos de relación del activo, con etiqueta e icono para la UI.
export const ACTIVO_ASIGNADO_TIPOS: { value: ActivoAsignadoTipo; label: string; icono: string }[] = [
  { value: 'proyecto', label: 'Obra / Proyecto', icono: '🏗️' },
  { value: 'empleado', label: 'Empleado', icono: '👷' },
  { value: 'ingeniero', label: 'Ingeniero', icono: '👤' },
  { value: 'almacen', label: 'Almacén', icono: '🏬' },
  { value: 'vehiculo', label: 'Vehículo', icono: '🚚' },
];
