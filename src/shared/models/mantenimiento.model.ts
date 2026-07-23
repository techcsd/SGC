// X6 — 4 tipos fijos de visita a taller.
export type MantenimientoTipo = 'preventivo' | 'falla' | 'accidente_dano' | 'cambio_pieza';
export type MantenimientoEstado = 'pendiente' | 'en_proceso' | 'completado';

export interface Mantenimiento {
  id: string;
  vehiculo_id: string;
  vehiculo?: { placa: string; marca: string; modelo: string };
  tipo: MantenimientoTipo;
  descripcion: string;
  fecha: string;
  costo: number | null;
  kilometraje_al_mantenimiento: number | null;
  proveedor: string | null;
  estado: MantenimientoEstado;
  notas: string | null;
  fotos?: string[];
  es_prueba?: boolean;
  incluye_preventivo?: boolean;
  accidente_id?: string | null;
  created_at: string;
}

export interface MantenimientoFormData {
  vehiculo_id: string;
  tipo: MantenimientoTipo;
  descripcion: string;
  fecha: string;
  costo: number | null;
  kilometraje_al_mantenimiento: number | null;
  proveedor: string | null;
  estado: MantenimientoEstado;
  notas: string | null;
  incluye_preventivo?: boolean;
  accidente_id?: string | null;
}

export const MANT_TIPOS: { value: MantenimientoTipo; label: string }[] = [
  { value: 'preventivo', label: 'Mantenimiento preventivo' },
  { value: 'falla', label: 'Reparación por falla/avería' },
  { value: 'accidente_dano', label: 'Reparación por accidente/daño' },
  { value: 'cambio_pieza', label: 'Cambio de pieza/consumible' },
];

/** Badge por tipo de visita (color) para listados/detalle. */
export const MANT_TIPO_BADGE: Record<MantenimientoTipo, string> = {
  preventivo: 'success',
  falla: 'warning',
  accidente_dano: 'danger',
  cambio_pieza: 'info',
};

export const MANT_ESTADOS = [
  { value: 'pendiente', label: 'Pendiente' },
  { value: 'en_proceso', label: 'En proceso' },
  { value: 'completado', label: 'Completado' },
];
