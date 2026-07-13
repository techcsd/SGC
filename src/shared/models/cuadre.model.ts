// A3.1 / A4 — Cuadre inicial por fases, Kit de inicio y alertas antifraude.

export type CuadreCategoria = 'almacen' | 'oficina' | 'cocina_bano' | 'material';

export interface CuadreObra {
  id: string;
  proyecto_id: string;
  bodega_id: string | null;
  fase_activa: number; // 1..4
  fase_auto?: boolean; // true = avanza automáticamente según el % de avance
  estado: 'borrador' | 'aprobado';
  aprobado_por: string | null;
  aprobado_en: string | null;
}

export interface CuadreItem {
  id: string;
  proyecto_id: string;
  articulo_id: string | null;
  descripcion: string;
  unidad: string | null;
  categoria: CuadreCategoria | string;
  es_kit: boolean;
  prorrateado: boolean;
  es_min_stock: boolean;
  cantidad_total: number;
  est_f1: number;
  est_f2: number;
  est_f3: number;
  est_f4: number;
  factor_base: number | null;
  factor: number | null;
  orden: number;
}

export interface CuadreItemFormData {
  articulo_id: string | null;
  descripcion: string;
  unidad: string | null;
  categoria: CuadreCategoria | string;
  es_min_stock?: boolean;
  cantidad_total: number;
  est_f1: number;
  est_f2: number;
  est_f3: number;
  est_f4: number;
  factor_base: number | null;
  factor: number | null;
}

export const CUADRE_CATEGORIAS: { value: CuadreCategoria; label: string }[] = [
  { value: 'material', label: 'Materiales de obra' },
  { value: 'almacen', label: 'Kit — Almacén' },
  { value: 'oficina', label: 'Kit — Oficina' },
  { value: 'cocina_bano', label: 'Kit — Cocina y baño' },
];

export const FASES_CUADRE = [
  { num: 1, label: '25%' },
  { num: 2, label: '50%' },
  { num: 3, label: '75%' },
  { num: 4, label: '100%' },
];

// ── A4 — Alertas antifraude ──────────────────────────────────
export type AlertaSeveridad = 'advertencia' | 'alerta';
export type AlertaEstado = 'nueva' | 'en_revision' | 'resuelta';

export interface AlertaCuadre {
  id: string;
  proyecto_id: string;
  proyecto?: { nombre: string };
  articulo_id: string | null;
  articulo?: { nombre: string };
  bodega_id?: string | null;
  bodega?: { nombre: string };
  fase: number | null;
  tipo: string;
  severidad: AlertaSeveridad;
  estimado: number | null;
  consumido: number | null;
  desviacion_pct: number | null;
  requisicion_id: string | null;
  mensaje: string | null;
  estado: AlertaEstado;
  nota: string | null;
  atendido_por: string | null;
  atendido_en: string | null;
  created_at: string;
  updated_at: string;
}

export const ALERTA_SEVERIDADES: Record<AlertaSeveridad, { label: string; badge: string }> = {
  advertencia: { label: 'Advertencia', badge: 'warning' },
  alerta: { label: 'Alerta', badge: 'danger' },
};
export const ALERTA_ESTADOS: { value: AlertaEstado; label: string; badge: string }[] = [
  { value: 'nueva', label: 'Nueva', badge: 'danger' },
  { value: 'en_revision', label: 'En revisión', badge: 'warning' },
  { value: 'resuelta', label: 'Resuelta', badge: 'success' },
];

export interface Parametro {
  clave: string;
  valor: string;
  descripcion: string | null;
  updated_at?: string;
}
