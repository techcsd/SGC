/** BF2 — tipos de proveedor (multiselección). */
export type ProveedorTipo = 'ferreteria' | 'suministros' | 'transportista' | 'otro';

export const PROVEEDOR_TIPOS: { key: ProveedorTipo; label: string }[] = [
  { key: 'ferreteria', label: 'Ferretería' },
  { key: 'suministros', label: 'Suministros' },
  { key: 'transportista', label: 'Transportista' },
  { key: 'otro', label: 'Otro' },
];

export interface Proveedor {
  id: string;
  nombre: string;
  rnc: string | null;
  contacto: string | null;
  telefono: string | null;
  email: string | null;
  direccion: string | null;
  activo: boolean;
  /** BF2 — tipos del proveedor (ferreteria/suministros/transportista/otro). */
  tipos?: ProveedorTipo[];
  /** AF32 — ferretería visible para choferes; sincronizado con el tipo 'ferreteria'. */
  is_hardware_store?: boolean;
  lat?: number | null;
  lng?: number | null;
  es_prueba?: boolean;
  created_at: string;
}
