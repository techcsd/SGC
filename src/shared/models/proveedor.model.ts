export interface Proveedor {
  id: string;
  nombre: string;
  rnc: string | null;
  contacto: string | null;
  telefono: string | null;
  email: string | null;
  direccion: string | null;
  activo: boolean;
  es_prueba?: boolean;
  created_at: string;
}
