export type VehiculoTipo =
  | 'camion'
  | 'pickup'
  | 'excavadora'
  | 'retroexcavadora'
  | 'bulldozer'
  | 'grua'
  | 'mixer'
  | 'compactadora'
  | 'montacargas'
  | 'otro';

export type VehiculoEstado = 'activo' | 'mantenimiento' | 'baja';

export interface Vehiculo {
  id: string;
  placa: string;
  marca: string;
  modelo: string;
  anio: number;
  tipo: VehiculoTipo;
  estado: VehiculoEstado;
  color: string | null;
  kilometraje: number;
  capacidad_carga: string | null;
  capacidad_valor: number | null;
  capacidad_unidad: string | null;
  responsable_id: string | null;
  responsable?: { nombre: string };
  notas: string | null;
  activo: boolean;
  created_at: string;
  updated_at: string;
}

export interface VehiculoFormData {
  placa: string;
  marca: string;
  modelo: string;
  anio: number;
  tipo: VehiculoTipo;
  estado: VehiculoEstado;
  color: string | null;
  kilometraje: number;
  capacidad_valor: number | null;
  capacidad_unidad: string | null;
  notas: string | null;
}

export const CAPACIDAD_UNIDADES: { value: string; label: string }[] = [
  { value: 't', label: 'Toneladas (t)' },
  { value: 'kg', label: 'Kilogramos (kg)' },
  { value: 'm3', label: 'Metros cúbicos (m³)' },
];

export const VEHICULO_TIPOS: { value: VehiculoTipo; label: string }[] = [
  { value: 'camion', label: 'Camión' },
  { value: 'pickup', label: 'Pickup' },
  { value: 'excavadora', label: 'Excavadora' },
  { value: 'retroexcavadora', label: 'Retroexcavadora' },
  { value: 'bulldozer', label: 'Bulldozer' },
  { value: 'grua', label: 'Grúa' },
  { value: 'mixer', label: 'Mixer / Hormigonera' },
  { value: 'compactadora', label: 'Compactadora' },
  { value: 'montacargas', label: 'Montacargas' },
  { value: 'otro', label: 'Otro' },
];

export const VEHICULO_ESTADOS: { value: VehiculoEstado; label: string }[] = [
  { value: 'activo', label: 'Activo' },
  { value: 'mantenimiento', label: 'En mantenimiento' },
  { value: 'baja', label: 'Dado de baja' },
];
