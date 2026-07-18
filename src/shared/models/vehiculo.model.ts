export type VehiculoTipo =
  | 'motocicleta'
  | 'automovil'
  | 'suv'
  | 'pickup'
  | 'camion'
  | 'excavadora'
  | 'retroexcavadora'
  | 'bulldozer'
  | 'grua'
  | 'mixer'
  | 'compactadora'
  | 'montacargas'
  | 'otro';

export type VehiculoEstado = 'activo' | 'mantenimiento' | 'no_disponible' | 'baja';

export interface Vehiculo {
  id: string;
  placa: string;
  // V1 — número VIN (chasis): identificador único para diferenciar vehículos casi
  // idénticos (mismo modelo/año, placas parecidas).
  vin: string | null;
  marca: string;
  modelo: string;
  anio: number;
  tipo: VehiculoTipo;
  estado: VehiculoEstado;
  color: string | null;
  kilometraje: number;
  // V2 — números de matrícula y seguro (la foto va por documentos; las fechas de
  // vencimiento ya existen abajo).
  numero_matricula: string | null;
  numero_seguro: string | null;
  aseguradora: string | null;
  capacidad_carga: string | null;
  capacidad_valor: number | null;
  capacidad_unidad: string | null;
  responsable_id: string | null;
  responsable?: { nombre: string };
  notas: string | null;
  fotos?: string[];
  // ── Flota v2: vencimientos + mantenimiento por km ──
  vencimiento_matricula: string | null;
  vencimiento_seguro: string | null;
  km_ultimo_mantenimiento: number | null;
  intervalo_mantenimiento_km: number;
  activo: boolean;
  created_at: string;
  updated_at: string;
}

export interface VehiculoFormData {
  placa: string;
  vin: string | null;
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
  numero_matricula: string | null;
  numero_seguro: string | null;
  aseguradora: string | null;
  vencimiento_matricula: string | null;
  vencimiento_seguro: string | null;
  km_ultimo_mantenimiento: number | null;
  intervalo_mantenimiento_km: number;
}

export type EstadoVencimiento = 'vigente' | 'por_vencer' | 'vencido';

/** Estado derivado de una fecha de vencimiento (≤ umbral días = por vencer). */
export function estadoVencimiento(
  fecha: string | null | undefined,
  umbralDias = 30,
): EstadoVencimiento | null {
  if (!fecha) return null;
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  const d = new Date(fecha + 'T00:00:00');
  const dias = Math.floor((d.getTime() - hoy.getTime()) / 86400000);
  if (dias < 0) return 'vencido';
  if (dias <= umbralDias) return 'por_vencer';
  return 'vigente';
}

export const VENCIMIENTO_LABEL: Record<EstadoVencimiento, string> = {
  vigente: 'Vigente',
  por_vencer: 'Por vencer',
  vencido: 'Vencido',
};
export const VENCIMIENTO_BADGE: Record<EstadoVencimiento, string> = {
  vigente: 'success',
  por_vencer: 'warning',
  vencido: 'danger',
};

/** Próximo mantenimiento (km) derivado de último + intervalo. */
export function proximoMantenimientoKm(v: Pick<Vehiculo, 'km_ultimo_mantenimiento' | 'intervalo_mantenimiento_km'>): number | null {
  if (v.km_ultimo_mantenimiento == null) return null;
  return v.km_ultimo_mantenimiento + (v.intervalo_mantenimiento_km || 5000);
}

/** Km que faltan para el próximo mantenimiento (negativo = vencido). */
export function kmFaltanMantenimiento(v: Vehiculo): number | null {
  const prox = proximoMantenimientoKm(v);
  if (prox == null) return null;
  return prox - (v.kilometraje ?? 0);
}

/** Tipos de vehículo considerados "livianos" (afecta el filtrado de ítems del
 *  checklist). P4: moto/auto/suv/pickup son livianos; camiones/maquinaria pesados.
 *  `otro` se mantiene liviano (comportamiento previo). Fácil de extender. */
const TIPOS_LIVIANOS = new Set<string>(['motocicleta', 'automovil', 'suv', 'pickup', 'otro']);

/** Clase Liviano/Pesado según el tipo (para filtrar ítems de checklist). */
export function claseVehiculo(tipo?: VehiculoTipo | string | null): 'Liviano' | 'Pesado' {
  return TIPOS_LIVIANOS.has(tipo ?? '') ? 'Liviano' : 'Pesado';
}

export const CAPACIDAD_UNIDADES: { value: string; label: string }[] = [
  { value: 't', label: 'Toneladas (t)' },
  { value: 'kg', label: 'Kilogramos (kg)' },
  { value: 'm3', label: 'Metros cúbicos (m³)' },
];

export const VEHICULO_TIPOS: { value: VehiculoTipo; label: string }[] = [
  { value: 'motocicleta', label: 'Motocicleta' },
  { value: 'automovil', label: 'Automóvil / Sedán' },
  { value: 'suv', label: 'SUV / Jeepeta' },
  { value: 'pickup', label: 'Pickup' },
  { value: 'camion', label: 'Camión' },
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
  { value: 'no_disponible', label: 'No disponible' },
  { value: 'baja', label: 'Dado de baja' },
];

export const VEHICULO_ESTADO_BADGE: Record<VehiculoEstado, string> = {
  activo: 'success',
  mantenimiento: 'warning',
  no_disponible: 'danger',
  baja: 'neutral',
};
