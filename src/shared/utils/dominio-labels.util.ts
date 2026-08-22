// AU15 — Diccionario CENTRAL de etiquetas para los enums del dominio. Un solo lugar
// donde `uso_proyecto` → "Uso en proyecto", `en_ruta` → "En ruta", etc., para que el
// MISMO valor se lea igual en toda la web (y en la app, que debe espejar este archivo).
// Regla: ninguna pantalla muestra un valor crudo (snake_case / MAYÚSCULAS). Si un valor
// no está mapeado, `humanizarEnum` lo vuelve legible como red de seguridad.

import { SALIDA_ESTADO_LABELS, MOTIVOS_SALIDA } from '../models/salida.model';

/** Estado de un conduce/salida (reusa la fuente del modelo). */
export const CONDUCE_ESTADO_LABELS: Record<string, string> = { ...SALIDA_ESTADO_LABELS };

/** Motivo de una salida/conduce (reusa MOTIVOS_SALIDA como fuente única). */
export const CONDUCE_MOTIVO_LABELS: Record<string, string> = Object.fromEntries(
  MOTIVOS_SALIDA.map((m) => [m.value, m.label]),
);

/** Fase del conduce (derivada server-side). */
export const CONDUCE_FASE_LABELS: Record<string, string> = {
  emitido: 'Emitido',
  en_transito: 'En tránsito',
  en_ruta: 'En ruta',
  por_confirmar: 'Por confirmar',
  entregado: 'Entregado',
  cerrado: 'Cerrado',
};

/** Estado del chofer (paridad con Seguimiento). */
export const CHOFER_ESTADO_LABELS: Record<string, string> = {
  disponible: 'Disponible',
  en_ruta: 'En ruta',
  descanso: 'Descanso',
  almuerzo: 'Almuerzo',
  inactivo: 'Inactivo',
  otros: 'Otros',
};

/** Estado de una ruta de transporte. */
export const RUTA_ESTADO_LABELS: Record<string, string> = {
  pendiente: 'Pendiente',
  en_ruta: 'En ruta',
  iniciada: 'Iniciada',
  finalizada: 'Finalizada',
  cancelada: 'Cancelada',
  modificada: 'Modificada',
};

/** Tipo de movimiento de inventario (ledger). */
export const MOVIMIENTO_TIPO_LABELS: Record<string, string> = {
  entrada: 'Entrada',
  salida: 'Salida',
  ajuste: 'Ajuste',
  apertura: 'Apertura',
  devolucion: 'Devolución',
  traslado: 'Traslado',
};

/**
 * Red de seguridad: convierte cualquier valor crudo de enum (`snake_case`, `MAYÚSCULAS`,
 * `kebab-case`) en texto legible. Se usa cuando no hay un mapa específico, para que NUNCA
 * se muestre un valor técnico en la UI (regla AU15).
 */
export function humanizarEnum(valor: string | null | undefined): string {
  if (valor == null) return '';
  const s = String(valor).trim();
  if (!s) return '';
  const limpio = s.replace(/[_-]+/g, ' ').toLowerCase().trim();
  return limpio.charAt(0).toUpperCase() + limpio.slice(1);
}

/** Mapas registrados por "grupo" del dominio, para el helper genérico `traducir`. */
const GRUPOS: Record<string, Record<string, string>> = {
  conduce_estado: CONDUCE_ESTADO_LABELS,
  conduce_motivo: CONDUCE_MOTIVO_LABELS,
  conduce_fase: CONDUCE_FASE_LABELS,
  chofer_estado: CHOFER_ESTADO_LABELS,
  ruta_estado: RUTA_ESTADO_LABELS,
  movimiento_tipo: MOVIMIENTO_TIPO_LABELS,
};

export type DominioGrupo = keyof typeof GRUPOS;

/**
 * Traduce un valor de enum a su etiqueta en español usando el mapa del grupo indicado;
 * si el valor no está en el mapa, cae a `humanizarEnum` (nunca devuelve el valor crudo).
 */
export function traducir(grupo: DominioGrupo, valor: string | null | undefined): string {
  if (valor == null || valor === '') return '';
  return GRUPOS[grupo]?.[valor] ?? humanizarEnum(valor);
}
