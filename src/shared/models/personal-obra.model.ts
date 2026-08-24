// AR1 — Registro de Personal de obra.

export type Nacionalidad = 'dominicano' | 'haitiano' | 'otro';
// AV4 — id_permiso_trabajo = el "ID" que RRHH describe como permiso de trabajo (haitianos).
export type TipoDocumento = 'cedula' | 'id_permiso_trabajo' | 'pasaporte' | 'carnet_electoral' | 'ninguno';
export type EstadoPersonal = 'activo' | 'inactivo';
// AV4 — estado de aseguramiento (flag manual + fecha + documento de respaldo opcional).
export type AseguramientoEstado = 'asegurado' | 'no_asegurado' | 'desconocido';

/** Los 5 tipos de foto de evidencia (en orden del wizard). */
export type FotoTipo = 'persona' | 'documento' | 'pared' | 'carnet' | 'persona_carnet_cedula';

export interface Cargo {
  id: string;
  codigo: string;
  nombre: string;
  descripcion?: string | null;
  categoria?: string | null;
  activo: boolean;
  orden: number;
}

export interface PersonalFoto {
  id: string;
  personal_id: string;
  tipo: FotoTipo;
  foto_path: string;
  created_at: string;
}

export interface PersonalFirma {
  id: string;
  personal_id: string;
  plantilla_id?: string | null;
  documento_nombre: string;
  firma_path: string;
  documento_path?: string | null;
  metodo: 'pad' | 'foto';
  firmado_at: string;
}

export interface PersonalObra {
  id: string;
  proyecto_id: string;
  nombre: string;
  apellido?: string | null;
  nacionalidad: Nacionalidad;
  tipo_documento: TipoDocumento;
  documento_numero?: string | null;
  cargo_id?: string | null;
  empleado_id?: string | null;
  telefono?: string | null;
  notas?: string | null;
  // AV4 — eje TECNICO (cuadrilla) + aseguramiento + activo en la obra (ciclo de import).
  cuadrilla?: string | null;
  aseguramiento_estado?: AseguramientoEstado;
  aseguramiento_fecha?: string | null;
  aseguramiento_doc_path?: string | null;
  activo_en_obra?: boolean;
  carnet_numero?: string | null;
  carnet_emitido_at?: string | null;
  carnet_emitido_por?: string | null;
  estado: EstadoPersonal;
  es_prueba?: boolean;
  registrado_por?: string | null;
  created_at: string;
  updated_at: string;
  // joins
  cargo?: Cargo | null;
  proyecto?: { nombre: string; codigo?: string | null } | null;
}

export interface PersonalConteos {
  total: number;
  por_cargo: { cargo: string; codigo: string | null; total: number }[];
  por_nacionalidad: { nacionalidad: string; total: number }[];
}

export const NACIONALIDADES: { value: Nacionalidad; label: string }[] = [
  { value: 'dominicano', label: 'Dominicano' },
  { value: 'haitiano', label: 'Haitiano' },
  { value: 'otro', label: 'Otra' },
];

export const TIPOS_DOCUMENTO: { value: TipoDocumento; label: string }[] = [
  { value: 'cedula', label: 'Cédula' },
  { value: 'id_permiso_trabajo', label: 'ID / permiso de trabajo' },
  { value: 'pasaporte', label: 'Pasaporte' },
  { value: 'carnet_electoral', label: 'Carnet electoral' },
  { value: 'ninguno', label: 'Sin documento' },
];

// AV4 — estados de aseguramiento para el semáforo de la vista de control.
export const ASEGURAMIENTO_ESTADOS: { value: AseguramientoEstado; label: string }[] = [
  { value: 'asegurado', label: 'Asegurado' },
  { value: 'no_asegurado', label: 'No asegurado' },
  { value: 'desconocido', label: 'Sin dato' },
];

/** Guía de las 5 fotos del expediente (orden + instrucción). */
export const FOTOS_GUIA: { tipo: FotoTipo; label: string; ayuda: string }[] = [
  { tipo: 'persona', label: 'Foto de la persona', ayuda: 'Rostro visible, de frente.' },
  { tipo: 'documento', label: 'Foto del documento', ayuda: 'Cédula o pasaporte, legible.' },
  { tipo: 'pared', label: 'Foto pegado a la pared', ayuda: 'Cuerpo de frente contra la pared (tipo ficha).' },
  { tipo: 'carnet', label: 'Foto del carnet', ayuda: 'El carnet emitido, legible.' },
  { tipo: 'persona_carnet_cedula', label: 'Persona con carnet y cédula', ayuda: 'Sosteniendo el carnet y la cédula, rostro visible.' },
];

export const NACIONALIDAD_LABEL: Record<string, string> = {
  dominicano: 'Dominicano',
  haitiano: 'Haitiano',
  otro: 'Otra',
};
