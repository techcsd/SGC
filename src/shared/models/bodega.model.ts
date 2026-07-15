export interface Bodega {
  id: string;
  nombre: string;
  descripcion: string | null;
  ubicacion: string | null;
  activo: boolean;
  created_at: string;
  proyecto_id?: string | null;
  es_principal?: boolean;
  proyecto?: { nombre: string } | null;
  // U22 — coordenadas para usar el almacén como origen/destino de rutas
  latitud?: number | null;
  longitud?: number | null;
}

export interface BodegaFormData {
  nombre: string;
  descripcion: string | null;
  ubicacion: string | null;
  activo: boolean;
  proyecto_id: string | null;
  es_principal: boolean;
  latitud: number | null;
  longitud: number | null;
}
