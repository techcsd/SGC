// Avisos de flota — bandeja gestionable (pendiente/atendido) alimentada por los
// RPCs de checklist/combustible y por el job de vencimientos.

export type AvisoFlotaTipo =
  | 'bloqueo_critico'
  | 'hallazgos'
  | 'pre_cita'
  | 'mantenimiento_vencido'
  | 'consumo_anormal'
  | 'licencia'
  | 'matricula'
  | 'seguro'
  | 'reporte_semanal'
  | 'conciliacion'
  // X1 — tipos separados por-vencer (amarillo) vs vencida (rojo)
  | 'licencia_por_vencer'
  | 'licencia_vencida'
  | 'matricula_por_vencer'
  | 'matricula_vencida'
  | 'seguro_por_vencer'
  | 'seguro_vencida'
  // Y9 3.3 — dato de mantenimiento incoherente (km último > odómetro)
  | 'mantenimiento_por_revisar';

export type AvisoFlotaEstado = 'pendiente' | 'atendido' | 'resuelto_auto';
export type AvisoFlotaSeveridad = 'baja' | 'media' | 'alta';

export interface AvisoFlota {
  id: string;
  tipo: AvisoFlotaTipo;
  vehiculo_id: string | null;
  conductor_id: string | null;
  referencia_id: string | null;
  mensaje: string;
  severidad: AvisoFlotaSeveridad;
  estado: AvisoFlotaEstado;
  dedup_key: string | null;
  atendido_por: string | null;
  atendido_at: string | null;
  nota_atencion: string | null;
  created_at: string;
  // X2 — auto-resolución
  resuelto_at?: string | null;
  resuelto_nota?: string | null;
  vehiculo?: { placa: string; marca: string } | null;
  conductor?: { nombre: string } | null;
}

export const AVISO_TIPO_LABEL: Record<AvisoFlotaTipo, string> = {
  bloqueo_critico: 'Bloqueo crítico',
  hallazgos: 'Hallazgos',
  pre_cita: 'Pre-cita de mantenimiento',
  mantenimiento_vencido: 'Mantenimiento vencido',
  consumo_anormal: 'Consumo anormal',
  licencia: 'Licencia por vencer',
  matricula: 'Matrícula por vencer',
  seguro: 'Seguro por vencer',
  reporte_semanal: 'Reporte semanal pendiente',
  conciliacion: 'Conciliación de combustible',
  licencia_por_vencer: 'Licencia por vencer',
  licencia_vencida: 'Licencia vencida',
  matricula_por_vencer: 'Matrícula por vencer',
  matricula_vencida: 'Matrícula vencida',
  seguro_por_vencer: 'Seguro por vencer',
  seguro_vencida: 'Seguro vencido',
  mantenimiento_por_revisar: 'Mantenimiento por revisar',
};

export const AVISO_SEVERIDAD_BADGE: Record<AvisoFlotaSeveridad, string> = {
  alta: 'danger',
  media: 'warning',
  baja: 'info',
};

export const AVISO_TIPOS: { value: AvisoFlotaTipo; label: string }[] = (
  Object.keys(AVISO_TIPO_LABEL) as AvisoFlotaTipo[]
).map((t) => ({ value: t, label: AVISO_TIPO_LABEL[t] }));
