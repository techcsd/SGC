export interface Obra {
  id: string;
  codigo: string;
  nombre: string;
  cliente: string | null;
  localidad: string | null;
  estado: string;
  activo: boolean;
  created_at: string;
}
