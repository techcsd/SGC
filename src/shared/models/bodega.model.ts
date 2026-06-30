export interface Bodega {
  id: string;
  nombre: string;
  ubicacion: string | null;
  responsable_id: string | null;
  responsable?: { nombre: string };
  activo: boolean;
  created_at: string;
}

export interface BodegaFormData {
  nombre: string;
  ubicacion: string | null;
  activo: boolean;
}
