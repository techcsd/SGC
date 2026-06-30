export type ActivoEstado = 'activo' | 'mantenimiento' | 'baja';

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
  notas: string | null;
  activo: boolean;
  created_at: string;
}

export interface ActivoFormData {
  codigo: string;
  nombre: string;
  descripcion: string | null;
  categoria_id: number | null;
  valor_adquisicion: number;
  fecha_adquisicion: string;
  vida_util_anios: number | null;
  estado: ActivoEstado;
  ubicacion: string | null;
  notas: string | null;
  activo: boolean;
}

export const ACTIVO_ESTADOS: { value: ActivoEstado; label: string }[] = [
  { value: 'activo', label: 'Activo' },
  { value: 'mantenimiento', label: 'En mantenimiento' },
  { value: 'baja', label: 'Dado de baja' },
];
