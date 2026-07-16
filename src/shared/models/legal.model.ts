export type ExpedienteTipo =
  | 'laboral'
  | 'permiso'
  | 'reclamacion'
  | 'litigio'
  | 'cumplimiento'
  | 'contractual'
  | 'otro';
export type ExpedienteEstado = 'abierto' | 'en_proceso' | 'en_espera' | 'cerrado';
export type ExpedientePrioridad = 'baja' | 'media' | 'alta' | 'urgente';

export interface ExpedienteLegal {
  id: string;
  codigo: string;
  titulo: string;
  tipo: ExpedienteTipo;
  estado: ExpedienteEstado;
  prioridad: ExpedientePrioridad;
  proyecto_id: string | null;
  proyecto?: { nombre: string } | null;
  contraparte: string | null;
  descripcion: string | null;
  enlace: string | null;
  fecha_apertura: string;
  fecha_limite: string | null;
  fecha_cierre: string | null;
  responsable_id: string | null;
  responsable?: { nombre: string } | null;
  creado_por: string | null;
  created_at: string;
}

export interface ExpedienteNota {
  id: string;
  expediente_id: string;
  usuario_id: string | null;
  usuario?: { nombre: string } | null;
  nota: string;
  created_at: string;
}

export interface ExpedienteArchivo {
  id: string;
  expediente_id: string;
  nombre: string;
  archivo_path: string;
  tipo_mime: string | null;
  subido_por: string | null;
  created_at: string;
}

export type ContratoTipo = 'subcontrato' | 'proveedor' | 'laboral' | 'arrendamiento' | 'servicios' | 'otro';
export type ContratoEstado = 'borrador' | 'en_revision' | 'firmado' | 'vencido' | 'cancelado';

export interface Contrato {
  id: string;
  codigo: string;
  titulo: string;
  tipo: ContratoTipo;
  contraparte_nombre: string;
  proveedor_id: string | null;
  proveedor?: { nombre: string } | null;
  proyecto_id: string | null;
  proyecto?: { nombre: string } | null;
  documento_generado_id: string | null;
  estado: ContratoEstado;
  monto: number | null;
  fecha_inicio: string | null;
  fecha_vencimiento: string | null;
  fecha_firma: string | null;
  responsable_id: string | null;
  responsable?: { nombre: string } | null;
  creado_por: string | null;
  created_at: string;
}

export type AprobacionModulo = 'compras' | 'rrhh' | 'proyectos' | 'inventario' | 'documentos' | 'flota' | 'otro';
export type AprobacionEstado = 'pendiente' | 'aprobado' | 'rechazado';

export interface AprobacionLegal {
  id: string;
  modulo_origen: AprobacionModulo;
  referencia_tipo: string | null;
  referencia_id: string | null;
  titulo: string;
  descripcion: string | null;
  estado: AprobacionEstado;
  solicitado_por: string;
  solicitante?: { nombre: string } | null;
  revisado_por: string | null;
  revisor?: { nombre: string } | null;
  comentario_revisor: string | null;
  fecha_solicitud: string;
  fecha_resolucion: string | null;
}

export const EXPEDIENTE_TIPOS: { value: ExpedienteTipo; label: string }[] = [
  { value: 'laboral', label: 'Laboral' },
  { value: 'permiso', label: 'Permiso / licencia' },
  { value: 'reclamacion', label: 'Reclamación' },
  { value: 'litigio', label: 'Litigio' },
  { value: 'cumplimiento', label: 'Cumplimiento normativo' },
  { value: 'contractual', label: 'Contractual' },
  { value: 'otro', label: 'Otro' },
];

export const EXPEDIENTE_ESTADOS: { value: ExpedienteEstado; label: string }[] = [
  { value: 'abierto', label: 'Abierto' },
  { value: 'en_proceso', label: 'En proceso' },
  { value: 'en_espera', label: 'En espera' },
  { value: 'cerrado', label: 'Cerrado' },
];

export const EXPEDIENTE_PRIORIDADES: { value: ExpedientePrioridad; label: string }[] = [
  { value: 'baja', label: 'Baja' },
  { value: 'media', label: 'Media' },
  { value: 'alta', label: 'Alta' },
  { value: 'urgente', label: 'Urgente' },
];

export const CONTRATO_TIPOS: { value: ContratoTipo; label: string }[] = [
  { value: 'subcontrato', label: 'Subcontrato de obra' },
  { value: 'proveedor', label: 'Proveedor' },
  { value: 'laboral', label: 'Laboral' },
  { value: 'arrendamiento', label: 'Arrendamiento' },
  { value: 'servicios', label: 'Servicios' },
  { value: 'otro', label: 'Otro' },
];

export const CONTRATO_ESTADOS: { value: ContratoEstado; label: string }[] = [
  { value: 'borrador', label: 'Borrador' },
  { value: 'en_revision', label: 'En revisión' },
  { value: 'firmado', label: 'Firmado' },
  { value: 'vencido', label: 'Vencido' },
  { value: 'cancelado', label: 'Cancelado' },
];

export const APROBACION_MODULOS: { value: AprobacionModulo; label: string }[] = [
  { value: 'compras', label: 'Compras' },
  { value: 'rrhh', label: 'RRHH' },
  { value: 'proyectos', label: 'Proyectos' },
  { value: 'inventario', label: 'Inventario' },
  { value: 'documentos', label: 'Documentos' },
  { value: 'flota', label: 'Flota' },
  { value: 'otro', label: 'Otro' },
];
