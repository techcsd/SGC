export type MantenimientoTipo = 'preventivo' | 'correctivo' | 'emergencia';
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
}

export const MANT_TIPOS = [
  { value: 'preventivo', label: 'Preventivo' },
  { value: 'correctivo', label: 'Correctivo' },
  { value: 'emergencia', label: 'Emergencia' },
];

export const MANT_ESTADOS = [
  { value: 'pendiente', label: 'Pendiente' },
  { value: 'en_proceso', label: 'En proceso' },
  { value: 'completado', label: 'Completado' },
];
