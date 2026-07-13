// A6 — Checklists digitales de Flota (pre-uso e inspección)

export type ChecklistTipo = 'pre_uso' | 'inspeccion';
export type ChecklistRespuestaValor = 'ok' | 'no' | 'na';
export type ChecklistCategoria = 'liviano' | 'camion' | 'equipo' | 'general';

export interface ChecklistPlantillaItem {
  id: string;
  plantilla_id: string;
  seccion: string;
  etiqueta: string;
  es_critico: boolean;
  orden: number;
}

export interface ChecklistPlantilla {
  id: string;
  codigo: string;
  nombre: string;
  categoria: ChecklistCategoria | string;
  descripcion: string | null;
  activo: boolean;
  orden: number;
  items?: ChecklistPlantillaItem[];
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
  vehiculo?: { placa: string; marca: string; modelo: string; tipo?: string };
  conductor_id: string | null;
  conductor?: { nombre: string };
  tipo: ChecklistTipo;
  fecha: string;
  datos: Record<string, unknown>;
  kilometraje: number | null;
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
