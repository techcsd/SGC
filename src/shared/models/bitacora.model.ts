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

export interface BitacoraActividad {
  id: string;
  bitacora_id: string;
  estructura: Estructura;
  actividad: Actividad;
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

export interface Bitacora {
  id: string;
  usuario_id: string;
  proyecto_id: string;
  proyecto?: { nombre: string; codigo: string };
  fecha: string;
  bloque_entrepiso: string;
  ingeniero_responsable: string;
  hora_fin_trabajo: string;
  personal_carpinteria: number;
  personal_acero: number;
  trabajadores_casa: number;
  otro_personal: string | null;
  comentarios: string | null;
  created_at: string;
  actividades?: BitacoraActividad[];
  restricciones?: BitacoraRestriccion[];
  archivos?: BitacoraArchivo[];
}

export interface BitacoraFormData {
  usuario_id: string;
  proyecto_id: string;
  fecha: string;
  bloque_entrepiso: string;
  ingeniero_responsable: string;
  hora_fin_trabajo: string;
  personal_carpinteria: number;
  personal_acero: number;
  trabajadores_casa: number;
  otro_personal: string | null;
  comentarios: string | null;
  actividades: { estructura: Estructura; actividad: Actividad }[];
  restricciones: { tipo_restriccion: string; descripcion_otro: string | null }[];
}
