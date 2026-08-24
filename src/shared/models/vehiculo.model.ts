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
  | 'telehandler'
  | 'otro';

export type VehiculoEstado = 'activo' | 'mantenimiento' | 'no_disponible' | 'baja';

/** Z15 — clasificación de uso del vehículo (afecta la variante de pre-uso servida). */
export type VehiculoUso = 'obra' | 'administrativo';

/** AA18.3 — unidad del odómetro: km (default) u horas (maquinaria por horómetro). */
export type VehiculoMedidaUso = 'km' | 'horas';

export interface Vehiculo {
  id: string;
  // AC14 — la placa es opcional en maquinaria pesada sin matrícula (telehandler,
  // excavadora…). Se identifican por VIN/serial. Ver EQUIPO_SIN_PLACA.
  placa: string | null;
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
  // AA18.3 — unidad del odómetro (km | horas). Los equipos por horómetro miden horas.
  medida_uso: VehiculoMedidaUso;
  // Z15 — obra | administrativo (default obra). Determina la variante de pre-uso.
  uso: VehiculoUso;
  // V2 — números de matrícula y seguro (la foto va por documentos; las fechas de
  // vencimiento ya existen abajo).
  numero_matricula: string | null;
  numero_seguro: string | null;
  aseguradora: string | null;
  capacidad_carga: string | null;
  capacidad_valor: number | null;
  capacidad_unidad: string | null;
  // AW3 — capacidad aproximada del tanque de combustible (galones). Si está llena,
  // manda sobre el tope por clase al validar/alertar echadas. Puede quedar vacía.
  capacidad_tanque_gal: number | null;
  responsable_id: string | null;
  responsable?: { nombre: string };
  notas: string | null;
  fotos?: string[];
  // ── Flota v2: vencimientos + mantenimiento por km ──
  vencimiento_matricula: string | null;
  vencimiento_seguro: string | null;
  km_ultimo_mantenimiento: number | null;
  intervalo_mantenimiento_km: number;
  // AA18.3 — ciclo de mantenimiento en HORAS (se usa cuando medida_uso = horas).
  intervalo_mantenimiento_horas: number | null;
  // S20 — rendimiento de referencia (km/gal) para comparar contra el promedio real.
  rendimiento_esperado_km_gal: number | null;
  // AA19 — path de la foto de portada (fallback: fotos[0]).
  foto_portada: string | null;
  activo: boolean;
  // AI13 — si false, el vehículo no aparece en los selects de los choferes
  // (admin/jefe de flota lo controla; ej. Hyundai Cantus, motos, administrativos).
  visible_choferes: boolean;
  // T2 — fila de datos de prueba (solo visible/eliminable por admin).
  es_prueba: boolean;
  created_at: string;
  updated_at: string;
}

export interface VehiculoFormData {
  // AC14 — null cuando el equipo no tiene placa (ver EQUIPO_SIN_PLACA / tipoSinPlaca).
  placa: string | null;
  vin: string | null;
  marca: string;
  modelo: string;
  anio: number;
  tipo: VehiculoTipo;
  estado: VehiculoEstado;
  color: string | null;
  kilometraje: number;
  medida_uso: VehiculoMedidaUso;
  uso: VehiculoUso;
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
  intervalo_mantenimiento_horas: number | null;
  rendimiento_esperado_km_gal: number | null;
  foto_portada: string | null;
  // T2 — marca de dato de prueba (opcional; solo lo escribe un admin).
  es_prueba?: boolean;
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

/**
 * Y9 3.3 — Contrato defensivo: el dato es incoherente si el km del último
 * mantenimiento supera el odómetro. En ese caso NO se calcula "faltan X km"
 * (se muestra "revisar dato" y el servidor emite un aviso a flota).
 */
export function mantenimientoPorRevisar(
  v: Pick<Vehiculo, 'km_ultimo_mantenimiento' | 'kilometraje'>,
): boolean {
  return (
    v.km_ultimo_mantenimiento != null &&
    v.kilometraje != null &&
    v.km_ultimo_mantenimiento > v.kilometraje
  );
}

/** AA18.3 — etiqueta corta de la unidad del odómetro del vehículo. */
export function unidadUso(v?: { medida_uso?: VehiculoMedidaUso | null } | null): 'km' | 'h' {
  return v?.medida_uso === 'horas' ? 'h' : 'km';
}

/** AA18.3 — etiqueta larga ("Kilometraje" / "Horas de uso") para labels de formulario. */
export function labelLecturaUso(medida?: VehiculoMedidaUso | null): string {
  return medida === 'horas' ? 'Horas de uso' : 'Kilometraje';
}

/** AA18.3 — intervalo de mantenimiento efectivo según la unidad del vehículo. */
export function intervaloMantenimiento(
  v: Pick<Vehiculo, 'medida_uso' | 'intervalo_mantenimiento_km' | 'intervalo_mantenimiento_horas'>,
): number {
  return v.medida_uso === 'horas'
    ? (v.intervalo_mantenimiento_horas || 250)
    : (v.intervalo_mantenimiento_km || 5000);
}

/** Próximo mantenimiento (en la unidad del vehículo) derivado de último + intervalo.
 *  Null si el dato es incoherente (por revisar) — así "faltan X" nunca muestra un disparate. */
export function proximoMantenimientoKm(
  v: Pick<Vehiculo, 'km_ultimo_mantenimiento' | 'intervalo_mantenimiento_km' | 'intervalo_mantenimiento_horas' | 'medida_uso' | 'kilometraje'>,
): number | null {
  if (v.km_ultimo_mantenimiento == null) return null;
  if (mantenimientoPorRevisar(v)) return null;
  return v.km_ultimo_mantenimiento + intervaloMantenimiento(v);
}

/** Unidades que faltan para el próximo mantenimiento (negativo = vencido). */
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

/** AC14 — maquinaria pesada sin matrícula/placa (se identifica por VIN/serial).
 *  Para estos tipos la placa es OPCIONAL en el formulario; el resto la exige. */
export const EQUIPO_SIN_PLACA: VehiculoTipo[] = [
  'telehandler', 'excavadora', 'retroexcavadora', 'bulldozer',
  'grua', 'mixer', 'compactadora', 'montacargas',
];
const _EQUIPO_SIN_PLACA = new Set<string>(EQUIPO_SIN_PLACA);

/** AC14 — true si el tipo es maquinaria sin placa (placa opcional en el form). */
export function tipoSinPlaca(tipo?: VehiculoTipo | string | null): boolean {
  return _EQUIPO_SIN_PLACA.has(tipo ?? '');
}

/** Z10 — Descripción canónica del vehículo: "Marca Modelo Año" (ej. "Izuzu D-Max 2023").
 *  Fuente única para listados, pickers, reportes y PDFs. El año se omite si no
 *  viniera (defensivo con datos parciales/embebidos). */
export function descripcionVehiculo(
  v?: { marca?: string | null; modelo?: string | null; anio?: number | null } | null,
): string {
  if (!v) return '—';
  return [v.marca, v.modelo, v.anio].filter((p) => p !== null && p !== undefined && p !== '').join(' ').trim() || '—';
}

/** AT9 — Identificación homologada del vehículo: "Marca Modelo · Color · Placa"
 *  (ej. "Hyundai Cantus · Gris · G675571"). En la constructora rara vez se
 *  saben las placas, pero sí marca/modelo/color — por eso NO se identifica solo
 *  por placa. Degrada con datos parciales: omite las partes que falten y, para
 *  maquinaria sin placa, cae al VIN/serial si existe. Fuente única para
 *  listados, selectores, notificaciones y reportes. */
export function identificacionVehiculo(
  v?: {
    marca?: string | null;
    modelo?: string | null;
    color?: string | null;
    placa?: string | null;
    vin?: string | null;
  } | null,
): string {
  if (!v) return '—';
  const nombre = [v.marca, v.modelo].filter((p) => p !== null && p !== undefined && p !== '').join(' ').trim();
  const partes = [nombre, v.color, v.placa || v.vin].filter(
    (p) => p !== null && p !== undefined && p !== '',
  );
  return partes.join(' · ').trim() || '—';
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
  { value: 'telehandler', label: 'Telehandler' },
  { value: 'otro', label: 'Otro' },
];

// AA17 — "Administrativo" se muestra como "Oficina" (mismo valor en BD por
// retrocompatibilidad; determina la variante de pre-uso).
export const VEHICULO_USOS: { value: VehiculoUso; label: string }[] = [
  { value: 'obra', label: 'Obra' },
  { value: 'administrativo', label: 'Oficina' },
];

/** AA18.3 — unidad del odómetro. */
export const VEHICULO_MEDIDAS_USO: { value: VehiculoMedidaUso; label: string }[] = [
  { value: 'km', label: 'Kilómetros (km)' },
  { value: 'horas', label: 'Horas de uso (horómetro)' },
];

/** AA18.2 — colores estándar para el select del form (+ "Otro" → input manual). */
export const VEHICULO_COLORES: string[] = [
  'Blanco', 'Negro', 'Gris', 'Plateado', 'Rojo', 'Azul',
  'Verde', 'Amarillo', 'Naranja', 'Marrón',
];

/** AA18.4 — aseguradoras comunes RD; "Seguros Universal" es la habitual (default). */
export const VEHICULO_ASEGURADORAS: string[] = [
  'Seguros Universal', 'Seguros Reservas', 'Mapfre BHD', 'Seguros Sura',
  'La Colonial', 'Humano Seguros', 'Seguros Pepín', 'Angloamericana de Seguros',
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
