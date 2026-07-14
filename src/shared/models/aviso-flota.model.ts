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
  | 'reporte_semanal';

export type AvisoFlotaEstado = 'pendiente' | 'atendido';
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
};

export const AVISO_SEVERIDAD_BADGE: Record<AvisoFlotaSeveridad, string> = {
  alta: 'danger',
  media: 'warning',
  baja: 'info',
};

export const AVISO_TIPOS: { value: AvisoFlotaTipo; label: string }[] = (
  Object.keys(AVISO_TIPO_LABEL) as AvisoFlotaTipo[]
).map((t) => ({ value: t, label: AVISO_TIPO_LABEL[t] }));
