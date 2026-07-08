export interface Unidad {
  id: number;
  codigo: string;
  nombre: string;
  activo: boolean;
  created_at?: string;
}

export interface UnidadCreatePayload {
  codigo: string;
  nombre: string;
}
