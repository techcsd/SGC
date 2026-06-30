export interface Proveedor {
  id: string;
  nombre: string;
  ruc: string | null;
  telefono: string | null;
  email: string | null;
  direccion: string | null;
  categoria: string | null;
  contacto_nombre: string | null;
  notas: string | null;
  activo: boolean;
  created_at: string;
}

export const PROVEEDOR_CATEGORIAS = ['materiales', 'servicios', 'equipos', 'transporte', 'otro'];
