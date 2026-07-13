export type ProyectoEstado = 'planificacion' | 'en_progreso' | 'pausado' | 'completado' | 'cancelado';
export type ProyectoTipo = 'residencial' | 'comercial' | 'industrial' | 'infraestructura' | 'otro';

export interface Proyecto {
  id: string;
  codigo: string;
  nombre: string;
  cliente: string | null;
  tipo: ProyectoTipo | null;
  estado: ProyectoEstado;
  fecha_inicio: string | null;
  fecha_fin_estimada: string | null;
  fecha_fin_real: string | null;
  presupuesto: number | null;
  ubicacion: string | null;
  localidad: string | null;
  latitud: number | null;
  longitud: number | null;
  direccion_geo: string | null;
  descripcion: string | null;
  responsable_id: string | null;
  responsable?: { nombre: string };
  activo: boolean;
  created_at: string;
  fases?: FaseProyecto[];
}

export interface ProyectoEmpleado {
  id: string;
  proyecto_id: string;
  empleado_id: string | null;
  empleado?: { nombre: string; apellido: string; cargo: string };
  rol: string | null;
  /** A3.2: entidad externa (topógrafo/subcontratista) cuando no es empleado de RRHH. */
  externo_nombre?: string | null;
  externo_tipo?: string | null;
  desde?: string | null;
  hasta?: string | null;
  activo?: boolean;
  notas?: string | null;
  created_at: string;
}

/** Payload para agregar un miembro al Equipo de Obra (A3.2). */
export interface EquipoMiembroFormData {
  empleado_id: string | null;
  externo_nombre: string | null;
  externo_tipo: string | null;
  rol: string;
  desde: string | null;
  hasta: string | null;
  notas: string | null;
}

// A8 — Expediente de inicio de obra
export type ExpedienteEstado = 'pendiente' | 'cargado' | 'validado' | 'no_aplica';
export interface ExpedienteDoc {
  id: string;
  proyecto_id: string;
  codigo: string;
  nombre: string;
  area: string | null;
  estado: ExpedienteEstado;
  responsable_id: string | null;
  archivo_path: string | null;
  enlace: string | null;
  notas: string | null;
  orden: number;
  validado_por: string | null;
  validado_en: string | null;
}
export const EXPEDIENTE_ESTADOS: { value: ExpedienteEstado; label: string; badge: string }[] = [
  { value: 'pendiente', label: 'Pendiente', badge: 'warning' },
  { value: 'cargado', label: 'Cargado', badge: 'info' },
  { value: 'validado', label: 'Validado', badge: 'success' },
  { value: 'no_aplica', label: 'No aplica', badge: 'neutral' },
];
export interface ExpedienteResumen {
  proyecto_id: string;
  nombre: string;
  total: number;
  validados: number;
  pendientes: number;
  completo: boolean;
}

export interface FaseProyecto {
  id: string;
  proyecto_id: string;
  nombre: string;
  descripcion: string | null;
  estado: 'pendiente' | 'en_progreso' | 'completada';
  fecha_inicio: string | null;
  fecha_fin: string | null;
  progreso: number;
  orden: number;
}

export const PROYECTO_ESTADOS = [
  { value: 'planificacion', label: 'Planificación', badge: 'neutral' },
  { value: 'en_progreso', label: 'En progreso', badge: 'info' },
  { value: 'pausado', label: 'Pausado', badge: 'warning' },
  { value: 'completado', label: 'Completado', badge: 'success' },
  { value: 'cancelado', label: 'Cancelado', badge: 'danger' },
];

export const PROYECTO_TIPOS = [
  { value: 'residencial', label: 'Residencial' },
  { value: 'comercial', label: 'Comercial' },
  { value: 'industrial', label: 'Industrial' },
  { value: 'infraestructura', label: 'Infraestructura' },
  { value: 'otro', label: 'Otro' },
];

export const FASE_ESTADOS = [
  { value: 'pendiente', label: 'Pendiente', badge: 'neutral' },
  { value: 'en_progreso', label: 'En progreso', badge: 'info' },
  { value: 'completada', label: 'Completada', badge: 'success' },
];

// Suggested roles for project team members (datalist — keeps labels consistent).
export const ROLES_PROYECTO = [
  'Encargado de obra',
  'Ingeniero residente',
  'Maestro constructor',
  'Supervisor',
  'Capataz',
  'Topógrafo',
  'Administrativo de obra',
  'Seguridad',
];

// A3.2 — Catálogo autoritativo del Equipo de Obra (CSD-OPE-01 Rev.05 §5).
// `externo`: por defecto es entidad externa (subcontratada). `multiple`: admite varios.
export interface RolObra {
  value: string;
  label: string;
  descripcion?: string;
  externo?: boolean;
  multiple?: boolean;
}
export const ROLES_OBRA: RolObra[] = [
  { value: 'ing_responsable', label: 'Ingeniero Responsable de Obra / Gerente de Proyecto', descripcion: 'Máxima autoridad técnica; autoriza vaciados.' },
  { value: 'ing_residente', label: 'Ingeniero Residente', descripcion: 'Ejecución diaria; único que escala requisiciones.' },
  { value: 'capataz', label: 'Capataz de Obra', descripcion: 'Mano derecha del Residente; dirige a los peones.' },
  { value: 'maestro_acero', label: 'Maestro de Acero' },
  { value: 'maestro_encofrado', label: 'Maestro de Encofrado', descripcion: 'También responsable de organización y limpieza.' },
  { value: 'encargado_seguridad', label: 'Encargado de Seguridad', descripcion: 'Análisis de riesgo, charlas diarias, EPP/EPC.' },
  { value: 'guarda_almacen', label: 'Guarda-Almacén', descripcion: 'Almacén de obra: recepciones, despachos, stock mínimo, inventario diario.' },
  { value: 'topografo', label: 'Topógrafo', descripcion: 'Empresa subcontratada; entregables en DWG.', externo: true },
  { value: 'cuadrilla', label: 'Cuadrilla / Ayudante', multiple: true },
  { value: 'subcontratista', label: 'Subcontratista', externo: true, multiple: true },
];

// Roles de supervisión a nivel de gerencia (NO por proyecto — informativos).
export const ROLES_GERENCIA_OBRA: RolObra[] = [
  { value: 'gerente_produccion', label: 'Gerente de Producción', descripcion: 'Responsable mayor de todas las obras.' },
  { value: 'ing_supervisor_general', label: 'Ingeniero Supervisor General', descripcion: 'Sin obra fija; apoyo y auditor interno de todas las obras.' },
];

export function rolObraLabel(value: string | null | undefined): string {
  if (!value) return '';
  return ROLES_OBRA.find((r) => r.value === value)?.label
    ?? ROLES_GERENCIA_OBRA.find((r) => r.value === value)?.label
    ?? value;
}
