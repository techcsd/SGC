// A6 — Checklists digitales de Flota (pre-uso e inspección)

export type ChecklistTipo = 'pre_uso' | 'inspeccion';
export type ChecklistRespuestaValor = 'ok' | 'no' | 'na';
export type ChecklistCategoria = 'liviano' | 'camion' | 'equipo' | 'general';
export type ChecklistResultado = 'aprobado' | 'con_hallazgos' | 'bloqueado';
export type AlertaMantenimiento = 'ok' | 'pre_cita' | 'vencido';
export type AplicaA = 'Liviano' | 'Pesado' | 'Ambos';

export interface ChecklistPlantillaItem {
  id: string;
  plantilla_id: string;
  seccion: string;
  numero: string | null;
  etiqueta: string;
  es_critico: boolean;
  aplica_a: AplicaA;
  orden: number;
}

/** U8/U10 — 'preuso' (inspección diaria) vs 'semanal' (reporte semanal). */
export type ChecklistFrecuencia = 'preuso' | 'semanal';

export interface ChecklistPlantilla {
  id: string;
  codigo: string;
  nombre: string;
  categoria: ChecklistCategoria | string;
  descripcion: string | null;
  activo: boolean;
  orden: number;
  frecuencia?: ChecklistFrecuencia | string;
  items?: ChecklistPlantillaItem[];
}

/** U8 — etiqueta legible de la frecuencia de una plantilla. */
export function frecuenciaLabel(frecuencia: string | null | undefined): string {
  return frecuencia === 'semanal' ? 'Reporte semanal' : 'Pre-uso';
}

export interface ChecklistRespuesta {
  id: string;
  checklist_id: string;
  etiqueta: string;
  seccion: string | null;
  es_critico: boolean;
  respuesta: ChecklistRespuestaValor;
  comentario: string | null;
  orden: number;
}

export interface ChecklistFoto {
  id: string;
  checklist_id: string;
  storage_path: string;
  slot: string | null;
}

export interface ChecklistVehiculo {
  id: string;
  plantilla_id: string | null;
  plantilla?: { nombre: string };
  vehiculo_id: string;
  vehiculo?: {
    placa: string; marca: string; modelo: string; tipo?: string;
    vencimiento_matricula?: string | null; vencimiento_seguro?: string | null;
  };
  conductor_id: string | null;
  conductor?: {
    nombre: string; licencia_tipo?: string; licencia_numero?: string | null;
    licencia_vencimiento?: string | null; tipo_vehiculo_autorizado?: string;
  };
  tipo: ChecklistTipo;
  fecha: string;
  datos: Record<string, unknown>;
  kilometraje: number | null;
  nivel_combustible: string | null;
  resultado: ChecklistResultado | null;
  km_faltan_mantenimiento: number | null;
  alerta_mantenimiento: AlertaMantenimiento | null;
  firma_path: string | null;
  observaciones: string | null;
  tiene_criticos: boolean;
  atendido: boolean;
  atendido_por: string | null;
  atendido_en: string | null;
  nota_atencion: string | null;
  creado_por: string | null;
  capturado_en: string | null;
  created_at: string;
  respuestas?: ChecklistRespuesta[];
  fotos?: ChecklistFoto[];
}

/** Payload para registrar un checklist (web). */
export interface ChecklistFormData {
  plantilla_id: string;
  vehiculo_id: string;
  conductor_id: string | null;
  tipo: ChecklistTipo;
  fecha: string;
  datos: Record<string, unknown>;
  kilometraje: number | null;
  nivel_combustible: string | null;
  observaciones: string | null;
  respuestas: {
    etiqueta: string;
    seccion: string | null;
    es_critico: boolean;
    respuesta: ChecklistRespuestaValor;
    comentario: string | null;
    orden: number;
  }[];
}

export const NIVEL_COMBUSTIBLE_OPCIONES: string[] = ['1/4', '1/2', '3/4', 'Lleno'];

export const RESULTADO_META: Record<ChecklistResultado, { label: string; badge: string }> = {
  aprobado: { label: 'Aprobado', badge: 'success' },
  con_hallazgos: { label: 'Con hallazgos', badge: 'warning' },
  bloqueado: { label: 'Bloqueado', badge: 'danger' },
};

export const ALERTA_MANT_META: Record<AlertaMantenimiento, { label: string; badge: string }> = {
  ok: { label: 'Al día', badge: 'success' },
  pre_cita: { label: 'Agendar pre-cita', badge: 'warning' },
  vencido: { label: 'Mantenimiento vencido', badge: 'danger' },
};

/** Slots fijos de fotos del pre-uso v2 (7). */
export const FOTO_SLOTS: { slot: string; label: string; grupo: 'Exterior' | 'Interior' }[] = [
  { slot: 'delantera', label: 'Delantera', grupo: 'Exterior' },
  { slot: 'lateral_izq', label: 'Lateral izquierda', grupo: 'Exterior' },
  { slot: 'lateral_der', label: 'Lateral derecha', grupo: 'Exterior' },
  { slot: 'trasera', label: 'Trasera', grupo: 'Exterior' },
  { slot: 'tablero', label: 'Tablero', grupo: 'Interior' },
  { slot: 'interior_del', label: 'Interior delantero', grupo: 'Interior' },
  { slot: 'parte_trasera', label: 'Parte trasera', grupo: 'Interior' },
];

export const CHECKLIST_TIPOS: { value: ChecklistTipo; label: string }[] = [
  { value: 'pre_uso', label: 'Pre-uso' },
  { value: 'inspeccion', label: 'Inspección de seguridad' },
];

export const RESPUESTA_OPCIONES: { value: ChecklistRespuestaValor; label: string; badge: string }[] = [
  { value: 'ok', label: 'OK', badge: 'success' },
  { value: 'no', label: 'NO', badge: 'danger' },
  { value: 'na', label: 'N/A', badge: 'neutral' },
];

/** Mapea el tipo de vehículo a la categoría de plantilla sugerida. */
export function categoriaPorTipoVehiculo(tipo?: string | null): ChecklistCategoria {
  switch (tipo) {
    case 'pickup':
      return 'liviano';
    case 'camion':
    case 'mixer':
      return 'camion';
    case 'excavadora':
    case 'retroexcavadora':
    case 'bulldozer':
    case 'grua':
    case 'compactadora':
    case 'montacargas':
      return 'equipo';
    default:
      return 'general';
  }
}
