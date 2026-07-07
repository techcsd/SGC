export type ConversacionTipo = 'directa' | 'grupo';

export interface Conversacion {
  id: string;
  tipo: ConversacionTipo;
  nombre: string | null;
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
}
