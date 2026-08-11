export type ConversacionTipo = 'directa' | 'grupo';

export interface Conversacion {
  id: string;
  tipo: ConversacionTipo;
  nombre: string | null;
  descripcion?: string | null;
  avatar_path?: string | null;
  creado_por: string | null;
  created_at: string;
  // Derived client-side for display / sorting:
  participantes?: ParticipanteInfo[];
  ultimoMensaje?: Mensaje | null;
  noLeidos?: number;
  tituloMostrado?: string;
}

export interface ParticipanteInfo {
  usuario_id: string;
  nombre: string;
  last_read_at: string;
}

export interface Mensaje {
  id: string;
  conversacion_id: string;
  autor_id: string;
  autor?: { nombre: string } | null;
  contenido: string | null;
  archivo_path: string | null;
  archivo_nombre: string | null;
  archivo_mime: string | null;
  created_at: string;
  /** 'sistema' → evento de grupo (alguien entró/salió, se cambió el nombre…). */
  tipo?: 'texto' | 'sistema';
}

// ── Group management (grupo_info RPC) ──────────────────────
export type GrupoRol = 'admin' | 'miembro';

export interface GrupoParticipante {
  usuario_id: string;
  nombre: string;
  email: string;
  rol: GrupoRol;
  added_at: string;
  es_creador: boolean;
}

export interface GrupoInfo {
  id: string;
  tipo: ConversacionTipo;
  nombre: string | null;
  descripcion: string | null;
  avatar_path: string | null;
  creado_por: string | null;
  created_at: string;
  /** Rol del usuario actual dentro del grupo. */
  mi_rol: GrupoRol;
  participantes: GrupoParticipante[];
}
