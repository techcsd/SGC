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
  avatar_path?: string | null;
  created_at: string;
  updated_at: string;
  roles?: UsuarioRol[];
  /** W12 — última actividad registrada por canal (ping throttled 5 min). */
  ultima_actividad_web?: string | null;
  ultima_actividad_app?: string | null;
}
