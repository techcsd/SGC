/** Asignación de un vehículo a una persona (multi-asignación, R1). */
export interface VehiculoAsignacion {
  id: string;
  vehiculo_id: string;
  usuario_id: string | null;
  conductor_id: string | null;
  desde: string;
  hasta: string | null;
  activa: boolean;
  origen: 'admin' | 'auto';
  notas: string | null;
  created_at: string;
  usuario?: { nombre: string } | null;
  conductor?: { nombre: string } | null;
  vehiculo?: { placa: string; marca: string; modelo: string } | null;
}

/** Stats agregados por vehículo (vista sgc.v_vehiculo_stats, R4). */
export interface VehiculoStats {
  vehiculo_id: string;
  placa: string;
  km_actual: number;
  combustible_echadas: number;
  combustible_galones: number;
  combustible_monto: number;
  rendimiento_promedio: number | null;
  costo_por_km_promedio: number | null;
  ultima_echada: string | null;
  checklists_total: number;
  checklists_bloqueos: number;
  ultimo_checklist: string | null;
  mantenimientos_total: number;
  ultimo_mantenimiento: string | null;
  km_ultimo_mantenimiento: number | null;
  proximo_mantenimiento_km: number | null;
  asignaciones_activas: number;
  ultima_actividad: string | null;
}

export type EstadoLicencia = 'vigente' | 'por_vencer' | 'vencida' | 'sin_dato';

/** Stats agregados por conductor (vista sgc.v_conductor_stats, R5). */
export interface ConductorStats {
  conductor_id: string;
  nombre: string;
  licencia_vencimiento: string | null;
  estado_licencia: EstadoLicencia;
  checklists_total: number;
  checklists_bloqueos: number;
  ultimo_checklist: string | null;
  combustible_echadas: number;
  ultima_echada: string | null;
  vehiculos_usados: number;
  ultima_actividad: string | null;
}

export const ESTADO_LICENCIA_LABEL: Record<EstadoLicencia, string> = {
  vigente: 'Vigente',
  por_vencer: 'Por vencer',
  vencida: 'Vencida',
  sin_dato: 'Sin dato',
};
export const ESTADO_LICENCIA_BADGE: Record<EstadoLicencia, string> = {
  vigente: 'success',
  por_vencer: 'warning',
  vencida: 'danger',
  sin_dato: 'neutral',
};

/** Fila de cumplimiento del reporte semanal (vista sgc.v_reporte_semanal_cumplimiento, R3). */
export interface ReporteSemanalFila {
  anio: number;
  semana: number;
  semana_inicio: string;
  semana_fin: string;
  vehiculo_id: string;
  placa: string;
  chofer_nombre: string | null;
  chofer_usuario_id: string | null;
  checklist_id: string | null;
  reporte_fecha: string | null;
  resultado: string | null;
  tiene_reporte: boolean;
}
