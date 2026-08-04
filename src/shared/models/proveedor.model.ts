export interface Proveedor {
  id: string;
  nombre: string;
  rnc: string | null;
  contacto: string | null;
  telefono: string | null;
  email: string | null;
  direccion: string | null;
  activo: boolean;
  /** AF32 — ferretería visible para choferes como origen de conduce. */
  is_hardware_store?: boolean;
  lat?: number | null;
  lng?: number | null;
  es_prueba?: boolean;
  created_at: string;
}
