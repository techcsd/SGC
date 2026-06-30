export interface Rol {
  id: number;
  codigo: string;
  nombre: string;
  modulos: string[];
  descripcion?: string | null;
}

export interface UsuarioRol {
  rol: Rol;
}

export interface Usuario {
  id: string;
  nombre: string;
  email: string;
  activo: boolean;
  created_at: string;
  updated_at: string;
  roles?: UsuarioRol[];
}
