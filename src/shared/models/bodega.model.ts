export interface Bodega {
  id: string;
  nombre: string;
  descripcion: string | null;
  ubicacion: string | null;
  activo: boolean;
  created_at: string;
}

export interface BodegaFormData {
  nombre: string;
  descripcion: string | null;
  ubicacion: string | null;
  activo: boolean;
}
