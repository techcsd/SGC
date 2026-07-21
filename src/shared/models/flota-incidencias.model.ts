// S22/S24 — Accidentes, daños y multas de flota (modelo web).

export type AccidenteFase = 'en_el_momento' | 'posterior';

export interface VehiculoAccidente {
  id: string;
  vehiculo_id: string;
  conductor_id: string | null;
  fecha: string;
  fase: AccidenteFase;
  descripcion: string | null;
  lesionados: number;
  tercero_involucrado: string | null;
  ubicacion_lat: number | null;
  ubicacion_lng: number | null;
  reporte_amet_path: string | null;
  creado_por: string | null;
  creado_en: string;
  // Joins opcionales
  vehiculo?: { placa: string; marca: string; modelo: string };
  conductor?: { nombre: string };
}

export type DanoOrigen = 'accidente' | 'uso' | 'desconocido';

export interface VehiculoDano {
  id: string;
  vehiculo_id: string;
  zona: string | null;
  descripcion: string | null;
  foto_path: string | null;
  origen: DanoOrigen;
  accidente_id: string | null;
  reportado_por: string | null;
  created_at: string;
}

export type MultaEstado = 'pendiente' | 'pagada';

export interface ConductorMulta {
  id: string;
  conductor_id: string;
  fecha: string;
  motivo: string | null;
  monto: number | null;
  vehiculo_id: string | null;
  accidente_id: string | null;
  documento_path: string | null;
  estado: MultaEstado;
  registrado_por: string | null;
  created_at: string;
  vehiculo?: { placa: string };
  conductor?: { nombre: string };
}

export const ACCIDENTE_FASES: { value: AccidenteFase; label: string }[] = [
  { value: 'en_el_momento', label: 'En el momento' },
  { value: 'posterior', label: 'Reporte posterior' },
];

export const DANO_ORIGENES: { value: DanoOrigen; label: string }[] = [
  { value: 'accidente', label: 'Accidente' },
  { value: 'uso', label: 'Uso normal' },
  { value: 'desconocido', label: 'Desconocido' },
];

export const MULTA_ESTADOS: { value: MultaEstado; label: string; badge: string }[] = [
  { value: 'pendiente', label: 'Pendiente', badge: 'warning' },
  { value: 'pagada', label: 'Pagada', badge: 'success' },
];

export interface AccidenteFormData {
  vehiculo_id: string;
  conductor_id: string | null;
  fecha: string;
  fase: AccidenteFase;
  descripcion: string | null;
  lesionados: number;
  tercero_involucrado: string | null;
}

export interface DanoFormData {
  vehiculo_id: string;
  zona: string | null;
  descripcion: string | null;
  origen: DanoOrigen;
  accidente_id: string | null;
}

export interface MultaFormData {
  conductor_id: string;
  fecha: string;
  motivo: string | null;
  monto: number | null;
  vehiculo_id: string | null;
  accidente_id: string | null;
  estado: MultaEstado;
}
