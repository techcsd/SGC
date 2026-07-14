export interface Categoria {
  id: number;
  nombre: string;
  descripcion: string | null;
  padre_id: number | null;
  activo: boolean;
  orden: number;
  destacada: boolean;
}

export interface CategoriaFormData {
  nombre: string;
  descripcion: string | null;
  orden: number;
  destacada: boolean;
  activo: boolean;
}

export interface CategoriaFlat extends Categoria {
  depth: number;
  label: string; // indented label for selects
}
