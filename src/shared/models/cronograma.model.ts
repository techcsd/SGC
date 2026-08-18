// Y15 — Cronograma de Proyectos.

export type CronogramaTipo = 'ordinaria' | 'importante' | 'critica';
export type CronogramaEstado = 'pendiente' | 'en_curso' | 'completada';

export interface CronogramaTarea {
  id: string;
  proyecto_id: string;
  fase_id: string | null;
  nombre: string;
  descripcion: string | null;
  tipo: CronogramaTipo;
  orden: number;
  duracion_dias_plan: number;
  fecha_inicio_plan: string | null;
  fecha_fin_plan: string | null;
  fecha_inicio_real: string | null;
  fecha_fin_real: string | null;
  estado: CronogramaEstado;
  justificacion_retraso: string | null;
  foto_evidencia_path: string | null;
  iniciada_por: string | null;
  completada_por: string | null;
  // AG16 fase4 — avance real reportado (0–100). Importado del Excel o calculado.
  avance_pct?: number | null;
  // AS21 — campos del cronograma importado (Excel real). Opcionales.
  responsable?: string | null;
  volumetria?: string | null;
  rendimiento?: string | null;
  grupo?: string | null;        // sub-sección dentro de la fase (ej. "ENTREPISO")
  es_prueba: boolean;
  created_at: string;
  updated_at: string;
}

export interface CronogramaRecalculo {
  id: string;
  proyecto_id: string;
  tarea_origen_id: string | null;
  tarea_destino_id: string | null;
  dias_movidos: number;
  motivo: 'adelanto_dona_critica' | 'holgura_general' | 'retraso_empuje';
  detalle: Record<string, unknown>;
  creado_por: string | null;
  created_at: string;
}

// AA24 — dependencias entre tareas (FS/SS/FF + lag).
export type DependenciaTipo = 'FS' | 'SS' | 'FF';

export interface CronogramaDependencia {
  id: string;
  predecesora_id: string;
  sucesora_id: string;
  tipo: DependenciaTipo;
  lag_dias: number;
}

export const DEPENDENCIA_TIPOS: { value: DependenciaTipo; label: string; desc: string }[] = [
  { value: 'FS', label: 'Fin → Comienzo (FS)', desc: 'empieza cuando la predecesora termina' },
  { value: 'SS', label: 'Comienzo → Comienzo (SS)', desc: 'empiezan juntas' },
  { value: 'FF', label: 'Fin → Fin (FF)', desc: 'terminan juntas' },
];

export interface CronogramaData {
  tareas: CronogramaTarea[];
  recalculos: CronogramaRecalculo[];
  // AA24 — presente desde la ronda de dependencias; opcional por retrocompatibilidad.
  dependencias?: CronogramaDependencia[];
}

export const CRONOGRAMA_TIPOS: { value: CronogramaTipo; label: string }[] = [
  { value: 'ordinaria', label: 'Ordinaria' },
  { value: 'importante', label: 'Importante' },
  { value: 'critica', label: 'Crítica' },
];

export const CRONOGRAMA_MOTIVOS: Record<CronogramaRecalculo['motivo'], string> = {
  adelanto_dona_critica: 'Adelanto: días donados a una tarea importante/crítica',
  holgura_general: 'Adelanto: días como holgura general',
  retraso_empuje: 'Retraso: empujó las tareas siguientes',
};

/** Una tarea está "atrasada" si no está completada y su fin plan ya pasó (condición derivada). */
export function esTareaAtrasada(t: CronogramaTarea, hoyIso: string): boolean {
  return t.estado !== 'completada' && !!t.fecha_fin_plan && t.fecha_fin_plan < hoyIso;
}
