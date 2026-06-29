export interface Categoria {
  id: number;
  nombre: string;
  descripcion: string | null;
  padre_id: number | null;
  activo: boolean;
}

export interface CategoriaFlat extends Categoria {
  depth: number;
  label: string; // indented label for selects
}
