// CSD-OPE-01 §8.2/§9 — Registro de Vaciado y No Conformidades (Ola 2).
// Elementos/frentes de obra, sus vaciados por fases y las NC que los bloquean.

export type VaciadoEstado = 'planificado' | 'liberado' | 'vaciado' | 'anulado';
export type NCEstado = 'abierta' | 'cerrada';
export type NCSeveridad = 'baja' | 'media' | 'alta' | 'critica';

export interface ObraElemento {
  id: string;
  proyecto_id: string;
  tipo: string | null; // excavacion|fundacion|columna|viga|losa|muro|escalera|otro
  codigo: string | null;
  eje: string | null;
  bloque: string | null;
  descripcion: string | null;
  created_at?: string;
}

export interface ObraElementoFormData {
  tipo: string | null;
  codigo: string | null;
  eje: string | null;
  bloque: string | null;
  descripcion: string | null;
}

export interface ObraVaciado {
  id: string;
  proyecto_id: string;
  elemento_id: string | null;
  numero: number | null;
  fecha: string | null;
  estado: VaciadoEstado;
  notas: string | null;
  created_at?: string;
  // Embed (obra_elementos)
  elemento?: { codigo: string | null; eje: string | null; bloque: string | null } | null;
}

export interface ObraVaciadoFormData {
  elemento_id: string | null;
  numero: number | null;
  fecha: string | null;
  notas?: string | null;
}

export interface ObraNoConformidad {
  id: string;
  proyecto_id: string;
  elemento_id: string | null;
  vaciado_id: string | null;
  descripcion: string;
  severidad: NCSeveridad | string;
  estado: NCEstado;
  bloquea_vaciado: boolean;
  creado_por: string | null;
  cerrada_en: string | null;
  created_at?: string;
}

export interface ObraNoConformidadFormData {
  elemento_id: string | null;
  vaciado_id: string | null;
  descripcion: string;
  severidad: NCSeveridad | string;
  bloquea_vaciado: boolean;
}

export const VACIADO_ESTADOS: { value: VaciadoEstado; label: string; badge: string }[] = [
  { value: 'planificado', label: 'Planificado', badge: 'neutral' },
  { value: 'liberado', label: 'Liberado', badge: 'info' },
  { value: 'vaciado', label: 'Vaciado', badge: 'success' },
  { value: 'anulado', label: 'Anulado', badge: 'danger' },
];

export const NC_SEVERIDADES: { value: NCSeveridad; label: string; badge: string }[] = [
  { value: 'baja', label: 'Baja', badge: 'info' },
  { value: 'media', label: 'Media', badge: 'warning' },
  { value: 'alta', label: 'Alta', badge: 'danger' },
  { value: 'critica', label: 'Crítica', badge: 'danger' },
];
