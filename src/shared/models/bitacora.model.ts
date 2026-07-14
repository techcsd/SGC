export const ESTRUCTURAS = [
  'COLUMNAS',
  'MUROS',
  'VIGAS',
  'LOSAS',
  'ZAPATAS/PLATEA',
  'VIGAS RIOSTRAS',
] as const;
export type Estructura = (typeof ESTRUCTURAS)[number];

export const ACTIVIDADES = [
  'TOPOGRAFIA',
  'CEPOS',
  'ENCOFRADO',
  'ARMADO',
  'LIBERACION MIVED',
  'TERMINACIONES DE ENCOFRADO/ARMADO',
  'VACIADO',
  'DESENCOFRADO',
] as const;
export type Actividad = (typeof ACTIVIDADES)[number];

export const RESTRICCIONES: { value: string; label: string }[] = [
  { value: 'NINGUNA', label: 'Ninguna' },
  { value: 'FALTA DE MATERIALES', label: 'Falta de materiales' },
  { value: 'FALTA DE EQUIPOS/HERRAMIENTAS', label: 'Falta de equipos/herramientas' },
  { value: 'INTERFERENCIA DE OTRAS BRIGADAS', label: 'Interferencia de otras brigadas' },
  { value: 'FALTA DE LIBERACION PARA INICIO DE TRABAJOS', label: 'Falta de liberación para inicio de trabajos' },
  { value: 'FALTA DEL CLIENTE', label: 'Falta del cliente' },
  { value: 'CLIMA', label: 'Clima' },
  { value: 'OTRO', label: 'Otro' },
];

import { WeatherSnapshot } from '../context/weather.model';

export interface BitacoraActividad {
  id: string;
  bitacora_id: string;
  // Catalog-validated (sgc.bitacora_catalogos) — admin-managed, so widened from
  // the old fixed unions to allow new values.
  estructura: string;
  actividad: string;
  cantidad: number | null; // R24 — cuántas se hicieron
}

export interface BitacoraRestriccion {
  id: string;
  bitacora_id: string;
  tipo_restriccion: string;
  descripcion_otro: string | null;
}

export interface BitacoraArchivo {
  id: string;
  bitacora_id: string;
  nombre: string;
  url: string;
  tipo_mime: string | null;
  tamano_bytes: number | null;
  created_at: string;
}

export type BitacoraTipo = 'parte_diario' | 'visita' | 'incidente';

export const BITACORA_TIPOS: { value: BitacoraTipo; label: string }[] = [
  { value: 'parte_diario', label: 'Parte diario de obra' },
  { value: 'visita', label: 'Visita a obra' },
  { value: 'incidente', label: 'Incidente / accidente' },
];

export const VISITANTE_TIPOS: { value: string; label: string }[] = [
  { value: 'institucion', label: 'Institución (MIVED, ayuntamiento, etc.)' },
  { value: 'propietario', label: 'Propietario' },
  { value: 'cliente', label: 'Cliente' },
  { value: 'supervisor_externo', label: 'Supervisor externo' },
  { value: 'proveedor', label: 'Proveedor' },
  { value: 'otro', label: 'Otro' },
];

export const INCIDENTE_TIPOS: { value: string; label: string }[] = [
  { value: 'incidente', label: 'Incidente (sin lesionados)' },
  { value: 'accidente', label: 'Accidente (con lesionados)' },
];

export const INCIDENTE_GRAVEDADES: { value: string; label: string }[] = [
  { value: 'leve', label: 'Leve' },
  { value: 'moderado', label: 'Moderado' },
  { value: 'grave', label: 'Grave' },
  { value: 'critico', label: 'Crítico' },
];

export interface Bitacora {
  id: string;
  usuario_id: string;
  proyecto_id: string;
  proyecto?: { nombre: string; codigo: string };
  fecha: string;
  tipo: BitacoraTipo;
  bloque_entrepiso: string | null;
  ingeniero_responsable: string | null;
  hora_fin_trabajo: string | null;
  personal_carpinteria: number;
  personal_acero: number;
  trabajadores_casa: number;
  otro_personal: string | null;
  comentarios: string | null;
  // Visita
  visita_tipo_visitante: string | null;
  visita_nombre: string | null;
  visita_organizacion: string | null;
  visita_motivo: string | null;
  // Incidente
  incidente_tipo: string | null;
  incidente_gravedad: string | null;
  incidente_subcontratista: string | null;
  incidente_lesionados: number | null;
  incidente_descripcion: string | null;
  incidente_acciones: string | null;
  // Clima + migración (R21/R22) — el clima NO es incidente
  llovio: boolean | null;
  lluvia_detalle: string | null;
  hubo_migracion: boolean | null;
  migracion_obreros: unknown | null;
  created_at: string;
  weather_snapshot_id: string | null;
  weather_snapshot?: WeatherSnapshot | null;
  actividades?: BitacoraActividad[];
  restricciones?: BitacoraRestriccion[];
  archivos?: BitacoraArchivo[];
}

export interface BitacoraFormData {
  usuario_id: string;
  proyecto_id: string;
  fecha: string;
  tipo: BitacoraTipo;
  comentarios: string | null;
  // Parte diario
  bloque_entrepiso: string | null;
  ingeniero_responsable: string | null;
  hora_fin_trabajo: string | null;
  personal_carpinteria: number;
  personal_acero: number;
  trabajadores_casa: number;
  otro_personal: string | null;
  actividades: { estructura: string; actividad: string; cantidad?: number | null }[];
  restricciones: { tipo_restriccion: string; descripcion_otro: string | null }[];
  // Visita
  visita_tipo_visitante: string | null;
  visita_nombre: string | null;
  visita_organizacion: string | null;
  visita_motivo: string | null;
  // Incidente
  incidente_tipo: string | null;
  incidente_gravedad: string | null;
  incidente_subcontratista: string | null;
  incidente_lesionados: number | null;
  incidente_descripcion: string | null;
  incidente_acciones: string | null;
  weather_snapshot_id?: string | null;
  // Clima + migración (R21/R22)
  llovio?: boolean | null;
  lluvia_detalle?: string | null;
  hubo_migracion?: boolean | null;
  migracion_obreros?: unknown | null;
}
