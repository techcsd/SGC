export interface Rol {
  id: number;
  codigo: string;
  nombre: string;
  modulos: string[];
  // AG12 — permisos granulares por submódulo ("modulo.submodulo" → 'ver'|'operar').
  permisos?: Record<string, 'ver' | 'operar'> | null;
  descripcion?: string | null;
}

export interface UsuarioRol {
  rol: Rol;
}

export interface Usuario {
  id: string;
  nombre: string;
  /** BH4 — el correo deja de ser obligatorio: el personal de campo entra por cédula. */
  email?: string | null;
  /** BH4 — cédula como identidad (personal sin correo). */
  cedula?: string | null;
  activo: boolean;
  avatar_path?: string | null;
  created_at: string;
  updated_at: string;
  roles?: UsuarioRol[];
  /** W12 — última actividad registrada por canal (ping throttled 5 min). */
  ultima_actividad_web?: string | null;
  ultima_actividad_app?: string | null;
  /** AY7 — usuario de prueba (banner + exclusión de lo real). Inmutable. */
  es_prueba?: boolean;
}
