export type RutaEstado = 'planificada' | 'en_curso' | 'completada' | 'cancelada';

export interface Ruta {
  id: string;
  vehiculo_id: string;
  vehiculo?: { placa: string; marca: string; modelo: string };
  conductor_id: string | null;
  conductor?: { nombre: string };
  origen: string;
  destino: string;
  fecha: string;
  km_estimado: number | null;
  km_real: number | null;
  tiempo_estimado_min: number | null;
  tiempo_real_min: number | null;
  estado: RutaEstado;
  notas: string | null;
  creado_por: string | null;
  created_at: string;
  updated_at: string;
}

export interface RutaFormData {
  vehiculo_id: string;
  conductor_id: string | null;
  origen: string;
  destino: string;
  fecha: string;
  km_estimado: number | null;
  tiempo_estimado_min: number | null;
  estado: RutaEstado;
  notas: string | null;
}

export const RUTA_ESTADOS: { value: RutaEstado; label: string; badge: string }[] = [
  { value: 'planificada', label: 'Planificada', badge: 'neutral' },
  { value: 'en_curso', label: 'En curso', badge: 'info' },
  { value: 'completada', label: 'Completada', badge: 'success' },
  { value: 'cancelada', label: 'Cancelada', badge: 'danger' },
];
