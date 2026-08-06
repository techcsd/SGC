// AG16 · Gestión de Producción de Obra — FASE 1: No Conformidades e Incidentes.
// Extiende CSD-OPE-01 (obra_no_conformidades) con el ciclo completo, más el motor
// de acciones correctivas y los incidentes/casi-accidentes de obra.

export type NCTipo = 'calidad' | 'orden_limpieza' | 'epp' | 'seguridad';
export type NCEstado = 'abierta' | 'en_correccion' | 'verificada' | 'cerrada';
export type NCSeveridad = 'baja' | 'media' | 'alta' | 'critica';

export interface UsuarioRef {
  id: string;
  nombre: string | null;
}
export interface ProyectoRef {
  id: string;
  nombre: string | null;
}

export interface ObraNC {
  id: string;
  proyecto_id: string;
  elemento_id: string | null;
  vaciado_id: string | null;
  titulo: string | null;
  tipo: NCTipo | null;
  descripcion: string;
  severidad: NCSeveridad | string;
  estado: NCEstado;
  ubicacion: string | null;
  responsable_id: string | null;
  fotos: string[];
  bloquea_vaciado: boolean;
  fecha_deteccion: string | null;
  creado_por: string | null;
  verificada_por: string | null;
  verificada_en: string | null;
  cerrada_en: string | null;
  created_at?: string;
  // Embeds
  proyecto?: ProyectoRef | null;
  responsable?: UsuarioRef | null;
}

export interface ObraNCFormData {
  proyecto_id: string;
  tipo: NCTipo | null;
  titulo: string | null;
  descripcion: string;
  severidad: NCSeveridad;
  ubicacion: string | null;
  responsable_id: string | null;
  elemento_id?: string | null;
  bloquea_vaciado: boolean;
}

export type AccionEstado = 'abierta' | 'hecha' | 'verificada';
export type AccionOrigen = 'nc' | 'incidente';

export interface AccionCorrectiva {
  id: string;
  proyecto_id: string;
  origen_tipo: AccionOrigen;
  origen_id: string;
  descripcion: string;
  responsable_id: string | null;
  fecha_compromiso: string | null;
  estado: AccionEstado;
  evidencia_fotos: string[];
  hecha_en: string | null;
  hecha_por: string | null;
  verificada_en: string | null;
  verificada_por: string | null;
  creado_por: string | null;
  created_at?: string;
  responsable?: UsuarioRef | null;
}

export type IncidenteTipo = 'casi_accidente' | 'incidente' | 'accidente';
export type IncidenteEstado = 'abierto' | 'en_investigacion' | 'cerrado';

export interface ObraIncidente {
  id: string;
  proyecto_id: string;
  elemento_id: string | null;
  bitacora_id: string | null;
  tipo: IncidenteTipo;
  descripcion: string;
  gravedad: NCSeveridad | string;
  lesionados: number;
  ubicacion: string | null;
  investigacion: string | null;
  fotos: string[];
  fecha: string;
  estado: IncidenteEstado;
  creado_por: string | null;
  cerrado_en: string | null;
  created_at?: string;
  proyecto?: ProyectoRef | null;
}

export interface ObraIncidenteFormData {
  proyecto_id: string;
  tipo: IncidenteTipo;
  descripcion: string;
  gravedad: NCSeveridad;
  lesionados: number;
  ubicacion: string | null;
  investigacion: string | null;
  fecha: string;
}

// ── Catálogos (labels + badges del design system) ──
export const NC_TIPOS: { value: NCTipo; label: string }[] = [
  { value: 'calidad', label: 'Calidad' },
  { value: 'orden_limpieza', label: 'Orden y limpieza' },
  { value: 'epp', label: 'EPP' },
  { value: 'seguridad', label: 'Seguridad' },
];

export const NC_SEVERIDADES: { value: NCSeveridad; label: string; badge: string }[] = [
  { value: 'baja', label: 'Baja', badge: 'info' },
  { value: 'media', label: 'Media', badge: 'warning' },
  { value: 'alta', label: 'Alta', badge: 'danger' },
  { value: 'critica', label: 'Crítica', badge: 'danger' },
];

export const NC_ESTADOS: { value: NCEstado; label: string; badge: string }[] = [
  { value: 'abierta', label: 'Abierta', badge: 'danger' },
  { value: 'en_correccion', label: 'En corrección', badge: 'warning' },
  { value: 'verificada', label: 'Verificada', badge: 'info' },
  { value: 'cerrada', label: 'Cerrada', badge: 'success' },
];

export const INCIDENTE_TIPOS: { value: IncidenteTipo; label: string }[] = [
  { value: 'casi_accidente', label: 'Casi-accidente' },
  { value: 'incidente', label: 'Incidente' },
  { value: 'accidente', label: 'Accidente' },
];

export const INCIDENTE_ESTADOS: { value: IncidenteEstado; label: string; badge: string }[] = [
  { value: 'abierto', label: 'Abierto', badge: 'danger' },
  { value: 'en_investigacion', label: 'En investigación', badge: 'warning' },
  { value: 'cerrado', label: 'Cerrado', badge: 'success' },
];

// ── FASE 2: Plan del día + Charla de seguridad + Checklists de calidad ──
export interface CharlaSeguridad {
  id: string;
  proyecto_id: string;
  fecha: string;
  tema: string | null;
  duracion_min: number | null;
  notas: string | null;
  asistentes: number | null;
  fotos: string[];
  firmas: string[];
  creado_por: string | null;
  created_at?: string;
}

export interface PlanTarea {
  id: string;
  titulo: string;
  descripcion: string | null;
  estado: string;
  prioridad: string;
  brigada: string | null;
  asignado_a: string | null;
  responsable: string | null;
  linked_tipo: string | null;
  linked_id: string | null;
}

export interface PlanDelDia {
  charla: CharlaSeguridad | null;
  tareas: PlanTarea[];
}

export type ChecklistCumple = 'ok' | 'no' | 'na';

export interface ClPlantilla {
  id: string;
  codigo: string;
  nombre: string;
  fase: string | null;
  categoria: string;
  orden: number;
  activo: boolean;
}

export interface ClPlantillaItem {
  id: string;
  plantilla_id: string;
  seccion: string | null;
  etiqueta: string;
  orden: number;
}

export interface ChecklistRespuestaInput {
  etiqueta: string;
  seccion: string | null;
  cumple: boolean | null; // true=ok, false=no cumple, null=n/a
  comentario: string | null;
  orden: number;
}

export interface ClRegistro {
  id: string;
  proyecto_id: string;
  plantilla_id: string | null;
  elemento_id: string | null;
  categoria: string;
  estado: string;
  observaciones: string | null;
  creado_por: string | null;
  created_at?: string;
  plantilla?: { nombre: string; codigo: string } | null;
  proyecto?: ProyectoRef | null;
}

// ── FASE 3: Subcontratistas + Cubicaciones ──
export interface ObraSubcontratista {
  id: string;
  nombre: string;
  rnc: string | null;
  especialidad: string | null;
  contacto: string | null;
  telefono: string | null;
  activo: boolean;
  created_at?: string;
}

export interface SubcontratistaFrente {
  id: string;
  subcontratista_id: string;
  proyecto_id: string;
  elemento_id: string | null;
  descripcion: string | null;
  avance_pct: number;
  activo: boolean;
  created_at?: string;
  proyecto?: ProyectoRef | null;
}

export type CubicacionEstado = 'borrador' | 'en_revision' | 'aprobada' | 'rechazada';

export interface ObraCubicacion {
  id: string;
  subcontratista_id: string;
  proyecto_id: string;
  periodo_inicio: string | null;
  periodo_fin: string | null;
  descripcion: string | null;
  monto: number;
  avance_pct: number | null;
  detalle: unknown[];
  soportes: string[];
  estado: CubicacionEstado;
  revisado_por: string | null;
  revisado_en: string | null;
  nota_revision: string | null;
  creado_por: string | null;
  created_at?: string;
  subcontratista?: { nombre: string } | null;
  proyecto?: ProyectoRef | null;
}

export interface CubicacionEvento {
  id: string;
  cubicacion_id: string;
  evento: string;
  estado_nuevo: string | null;
  nota: string | null;
  usuario_id: string | null;
  created_at: string;
}

export const CUBICACION_ESTADOS: { value: CubicacionEstado; label: string; badge: string }[] = [
  { value: 'borrador', label: 'Borrador', badge: 'neutral' },
  { value: 'en_revision', label: 'En revisión', badge: 'warning' },
  { value: 'aprobada', label: 'Aprobada', badge: 'success' },
  { value: 'rechazada', label: 'Rechazada', badge: 'danger' },
];

// ── FASE 4: Avance, Costos, Logística ──
export interface AvanceActual {
  avance_plan_pct: number;
  avance_real_pct: number;
}

export interface AvanceSnapshot {
  fecha: string;
  avance_plan_pct: number | null;
  avance_real_pct: number | null;
}

export interface CronogramaTareaAvance {
  id: string;
  nombre: string;
  estado: string;
  avance_pct: number;
  fecha_fin_plan: string | null;
}

export interface ManoObra {
  id: string;
  proyecto_id: string;
  fecha: string;
  actividad: string | null;
  cantidad_trabajadores: number;
  horas: number;
  horas_hombre: number;
  notas: string | null;
  created_at?: string;
}

export interface PruebaCampo {
  id: string;
  proyecto_id: string;
  tipo: string | null;
  fecha: string;
  resultado: string | null;
  notas: string | null;
  fotos: string[];
  created_at?: string;
}

export interface CostoMaterialItem {
  articulo_id: string;
  nombre: string | null;
  unidad: string | null;
  cantidad: number;
  costo_unit_prom: number | null;
  costo: number;
}
export interface CostoMaterial {
  total: number;
  por_articulo: CostoMaterialItem[];
}

export interface OCProgramada {
  id: string;
  numero: string | number | null;
  estado: string;
  total: number | null;
  fecha_programada: string | null;
  destino: string | null;
}

export interface ReportePerdida {
  id: string;
  proyecto_id: string;
  tipo: string | null;
  descripcion: string;
  fecha: string;
  fotos: string[];
  created_at?: string;
}

// ── FASE 5: Informe semanal ──
export interface InformeSecciones {
  avance_plan_pct?: number;
  avance_real_pct?: number;
  nc_abiertas?: number;
  nc_cerradas?: number;
  nc_criticas?: { titulo: string; severidad: string; tipo: string | null }[];
  incidentes?: { tipo: string; descripcion: string; gravedad: string; fecha: string }[];
  pedidos_pendientes?: number;
  horas_hombre?: number;
  pruebas_campo?: number;
  bitacoras?: number;
  fotos?: string[];
}

export interface InformeSemanal {
  id: string;
  proyecto_id: string;
  fecha: string;
  contenido: string | null;
  avance_pct: number | null;
  periodo_inicio: string | null;
  periodo_fin: string | null;
  secciones: InformeSecciones;
  campos_manuales: Record<string, string>;
  estado: 'borrador' | 'enviado';
  pdf_path: string | null;
  enviado_en: string | null;
  creado_por: string | null;
  created_at?: string;
  proyecto?: ProyectoRef | null;
}
