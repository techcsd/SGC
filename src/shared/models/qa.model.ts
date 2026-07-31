// AC3 — Módulo QA (gestión de pruebas). Casos reutilizables + corridas fechadas
// contra una versión, con snapshot del caso en cada resultado. Gateado a
// Tecnología por RLS (sgc.es_tecnologia()).

export type QaPrioridad = 'alta' | 'media' | 'baja';
export type QaPlataforma = 'web' | 'app' | 'ambas';
export type QaRunEstado = 'en_progreso' | 'completada' | 'abortada';
export type QaResultado = 'pendiente' | 'passed' | 'failed' | 'blocked' | 'skipped';

/** Caso de prueba reutilizable, organizado por `modulo`. */
export interface QaTestCase {
  id: string;
  modulo: string;
  titulo: string;
  precondiciones: string | null;
  pasos: string | null;
  resultado_esperado: string | null;
  prioridad: QaPrioridad;
  plataforma: QaPlataforma;
  activo: boolean;
  orden: number | null;
  creado_por: string | null;
  created_at: string;
  updated_at: string;
}

/** Corrida (ejecución fechada del checklist contra una versión objetivo). */
export interface QaTestRun {
  id: string;
  titulo: string | null;
  plataforma: QaPlataforma;
  version_objetivo: string | null;
  fecha: string;
  ejecutado_por: string | null;
  estado: QaRunEstado;
  notas: string | null;
  created_at: string;
  updated_at: string;
}

/** Resultado de un caso dentro de una corrida (con snapshot del caso). */
export interface QaTestRunResult {
  id: string;
  run_id: string;
  caso_id: string | null;
  caso_titulo: string;
  modulo: string;
  resultado: QaResultado;
  notas: string | null;
  evidencia_path: string | null;
  error_report_id: string | null;
  created_at: string;
  updated_at: string;
}

/** Cambios que se pueden aplicar a un resultado durante la ejecución. */
export interface QaResultadoPatch {
  resultado?: QaResultado;
  notas?: string | null;
  evidencia_path?: string | null;
  error_report_id?: string | null;
}

// ── Etiquetas y colores (UI en español) ─────────────────────────────────────

export const QA_PRIORIDADES: { value: QaPrioridad; label: string }[] = [
  { value: 'alta', label: 'Alta' },
  { value: 'media', label: 'Media' },
  { value: 'baja', label: 'Baja' },
];

export const QA_PLATAFORMAS: { value: QaPlataforma; label: string }[] = [
  { value: 'web', label: '💻 Web' },
  { value: 'app', label: '📱 App móvil' },
  { value: 'ambas', label: 'Ambas' },
];

export const QA_RUN_ESTADOS: { value: QaRunEstado; label: string }[] = [
  { value: 'en_progreso', label: 'En progreso' },
  { value: 'completada', label: 'Completada' },
  { value: 'abortada', label: 'Abortada' },
];

export const QA_RESULTADOS: { value: QaResultado; label: string }[] = [
  { value: 'pendiente', label: 'Pendiente' },
  { value: 'passed', label: 'Pasó' },
  { value: 'failed', label: 'Falló' },
  { value: 'blocked', label: 'Bloqueado' },
  { value: 'skipped', label: 'Omitido' },
];

/** Módulos disponibles para agrupar casos (texto plano). */
export const QA_MODULOS: string[] = [
  'general',
  'bitacora',
  'inventario',
  'compras',
  'proyectos',
  'flota',
  'documentos',
  'legal',
  'tareas',
  'rrhh',
  'mensajeria',
  'tecnologia',
  'admin',
];

export function qaPrioridadLabel(p: string): string {
  return QA_PRIORIDADES.find((x) => x.value === p)?.label ?? p;
}
export function qaPlataformaLabel(p: string): string {
  return QA_PLATAFORMAS.find((x) => x.value === p)?.label ?? p;
}
export function qaEstadoLabel(e: string): string {
  return QA_RUN_ESTADOS.find((x) => x.value === e)?.label ?? e;
}
export function qaResultadoLabel(r: string): string {
  return QA_RESULTADOS.find((x) => x.value === r)?.label ?? r;
}

/** Clase sgc-badge para un resultado. */
export function qaResultadoBadge(r: string): string {
  switch (r) {
    case 'passed':
      return 'sgc-badge sgc-badge--success';
    case 'failed':
      return 'sgc-badge sgc-badge--danger';
    case 'blocked':
      return 'sgc-badge sgc-badge--warning';
    case 'skipped':
    case 'pendiente':
    default:
      return 'sgc-badge sgc-badge--neutral';
  }
}

/** Clase sgc-badge para una prioridad. */
export function qaPrioridadBadge(p: string): string {
  switch (p) {
    case 'alta':
      return 'sgc-badge sgc-badge--danger';
    case 'media':
      return 'sgc-badge sgc-badge--warning';
    case 'baja':
    default:
      return 'sgc-badge sgc-badge--neutral';
  }
}

/** Clase sgc-badge para el estado de una corrida. */
export function qaRunEstadoBadge(e: string): string {
  switch (e) {
    case 'completada':
      return 'sgc-badge sgc-badge--success';
    case 'abortada':
      return 'sgc-badge sgc-badge--danger';
    case 'en_progreso':
    default:
      return 'sgc-badge sgc-badge--info';
  }
}
