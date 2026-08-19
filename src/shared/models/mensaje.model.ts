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
  /** AV5 — cursor "recibido en el dispositivo" (✓✓). */
  last_delivered_at?: string | null;
}

/** AV5 — recibo de un participante distinto del autor (para pintar ✓/✓✓/azul). */
export interface Recibo {
  usuario_id: string;
  nombre: string;
  last_read_at: string | null;
  last_delivered_at: string | null;
}

/** AV5 — estado de entrega/lectura de un mensaje propio, pintado en la burbuja. */
export type EstadoMensaje = 'enviado' | 'entregado' | 'leido';

/** AV5 — acción de presencia efímera en el canal chat:presencia:{conv}. */
export type PresenciaAccion = 'escribiendo' | 'grabando' | 'sticker' | 'nada';

export interface Mensaje {
  id: string;
  conversacion_id: string;
  autor_id: string;
  autor?: { nombre: string } | null;
  contenido: string | null;
  archivo_path: string | null;
  archivo_nombre: string | null;
  archivo_mime: string | null;
  /** AY14 — tamaño del adjunto en bytes (para la card de documento). */
  archivo_size?: number | null;
  created_at: string;
  /** 'sistema' → evento de grupo (alguien entró/salió, se cambió el nombre…).
   *  'sticker' → el mensaje es un sticker (ref guardado en archivo_path).
   *  'audio' → nota de voz (AV5/AW15): audio en archivo_path + duracion_seg. */
  tipo?: 'texto' | 'sistema' | 'sticker' | 'audio';
  /** AV5/AW15 — duración (segundos) de la nota de voz (tipo='audio'). */
  duracion_seg?: number | null;
}

// ── Stickers (AT16) ────────────────────────────────────────
export interface Sticker {
  id: string;
  /** Ref del sticker. Si `es_asset`, es una ruta de asset empaquetado
   *  ('assets/stickers/…'); si no, es un path dentro del bucket público
   *  `sgc-stickers`. Convertir a URL con `MensajeriaService.stickerUrl`. */
  ref: string;
  es_asset: boolean;
}

export interface StickerPack {
  id: string;
  nombre: string;
  es_sistema: boolean;
  orden: number;
  stickers: Sticker[];
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
