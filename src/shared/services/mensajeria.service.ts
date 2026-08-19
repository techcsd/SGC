import { Injectable, inject } from '@angular/core';
import { RealtimeChannel } from '@supabase/supabase-js';
import { SupabaseService } from '../../app/core/services/supabase.service';
import { Conversacion, GrupoInfo, Mensaje, ParticipanteInfo, StickerPack } from '../models/mensaje.model';
import { SignedUrlCache } from './signed-url-cache.service';
import { environment } from '../../environments/environment';

@Injectable({ providedIn: 'root' })
export class MensajeriaService {
  private supabase = inject(SupabaseService);
  private signedUrls = inject(SignedUrlCache);

  /** Company directory (id → nombre) — used to name participants, since the
   *  usuarios table RLS only lets a user read their own row. */
  async getDirectorio(): Promise<{ id: string; nombre: string }[]> {
    const { data, error } = await this.supabase.client.rpc('directorio_usuarios');
    if (error) throw new Error(error.message);
    return (data ?? []) as { id: string; nombre: string }[];
  }

  /** Full conversation list for the current user, enriched with display title,
   *  last message and unread count. */
  async getConversaciones(miId: string, nombrePorId: Map<string, string>): Promise<Conversacion[]> {
    // 1. My memberships → the conversations I belong to (+ my last_read_at).
    const { data: misMemb, error: e1 } = await this.supabase.client
      .from('conversacion_participantes')
      .select('conversacion_id, last_read_at, conversacion:conversaciones(*)')
      .eq('usuario_id', miId);
    if (e1) throw new Error(e1.message);

    const rows = (misMemb ?? []) as unknown as {
      conversacion_id: string;
      last_read_at: string;
      conversacion: Conversacion;
    }[];
    if (rows.length === 0) return [];

    const convIds = rows.map((r) => r.conversacion_id);
    const myLastRead = new Map(rows.map((r) => [r.conversacion_id, r.last_read_at]));

    // 2. All participants of those conversations (for naming + titles).
    const { data: parts, error: e2 } = await this.supabase.client
      .from('conversacion_participantes')
      .select('conversacion_id, usuario_id, last_read_at')
      .in('conversacion_id', convIds);
    if (e2) throw new Error(e2.message);

    const participantesPorConv = new Map<string, ParticipanteInfo[]>();
    for (const p of (parts ?? []) as { conversacion_id: string; usuario_id: string; last_read_at: string }[]) {
      const list = participantesPorConv.get(p.conversacion_id) ?? [];
      list.push({ usuario_id: p.usuario_id, nombre: nombrePorId.get(p.usuario_id) ?? 'Usuario', last_read_at: p.last_read_at });
      participantesPorConv.set(p.conversacion_id, list);
    }

    // 3. Messages for those conversations (recent first) → last message + unread.
    const { data: msgs, error: e3 } = await this.supabase.client
      .from('mensajes')
      .select('*')
      .in('conversacion_id', convIds)
      .order('created_at', { ascending: false })
      .limit(500);
    if (e3) throw new Error(e3.message);

    const ultimoPorConv = new Map<string, Mensaje>();
    const noLeidosPorConv = new Map<string, number>();
    for (const m of (msgs ?? []) as Mensaje[]) {
      if (!ultimoPorConv.has(m.conversacion_id)) ultimoPorConv.set(m.conversacion_id, m);
      const lastRead = myLastRead.get(m.conversacion_id);
      if (m.autor_id !== miId && lastRead && m.created_at > lastRead) {
        noLeidosPorConv.set(m.conversacion_id, (noLeidosPorConv.get(m.conversacion_id) ?? 0) + 1);
      }
    }

    const conversaciones: Conversacion[] = rows.map((r) => {
      const conv = r.conversacion;
      const participantes = participantesPorConv.get(r.conversacion_id) ?? [];
      let titulo = conv.nombre ?? '';
      if (conv.tipo === 'directa') {
        const otro = participantes.find((p) => p.usuario_id !== miId);
        titulo = otro?.nombre ?? 'Conversación';
      }
      return {
        ...conv,
        participantes,
        ultimoMensaje: ultimoPorConv.get(r.conversacion_id) ?? null,
        noLeidos: noLeidosPorConv.get(r.conversacion_id) ?? 0,
        tituloMostrado: titulo,
      };
    });

    // Most recently active first.
    conversaciones.sort((a, b) => {
      const ta = a.ultimoMensaje?.created_at ?? a.created_at;
      const tb = b.ultimoMensaje?.created_at ?? b.created_at;
      return tb.localeCompare(ta);
    });
    return conversaciones;
  }

  async getMensajes(conversacionId: string): Promise<Mensaje[]> {
    const { data, error } = await this.supabase.client
      .from('mensajes')
      .select('*, tipo, autor:usuarios(nombre)')
      .eq('conversacion_id', conversacionId)
      .order('created_at', { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as Mensaje[];
  }

  async enviarMensaje(
    conversacionId: string,
    autorId: string,
    contenido: string | null,
    file: File | null,
  ): Promise<Mensaje> {
    let archivoPath: string | null = null;
    let archivoNombre: string | null = null;
    let archivoMime: string | null = null;

    if (file) {
      const path = `${conversacionId}/${crypto.randomUUID()}-${file.name}`;
      const { error: upErr } = await this.supabase.client.storage.from('sgc-mensajes').upload(path, file);
      if (upErr) throw new Error(upErr.message);
      archivoPath = path;
      archivoNombre = file.name;
      archivoMime = file.type || null;
    }

    const { data, error } = await this.supabase.client
      .from('mensajes')
      .insert({
        conversacion_id: conversacionId,
        autor_id: autorId,
        contenido: contenido || null,
        archivo_path: archivoPath,
        archivo_nombre: archivoNombre,
        archivo_mime: archivoMime,
      })
      .select('*, autor:usuarios(nombre)')
      .single();
    if (error) throw new Error(error.message);
    return data as unknown as Mensaje;
  }

  /**
   * AW15 — envía una nota de voz: sube el audio al bucket sgc-mensajes y crea el
   * mensaje tipo 'audio' vía RPC `enviar_nota_voz` (idempotente por client_msg_id).
   * Devuelve el mensaje insertado para pintarlo optimista en el hilo.
   */
  async enviarNotaVoz(
    conversacionId: string,
    blob: Blob,
    duracionSeg: number,
    clientId: string,
  ): Promise<Mensaje> {
    const mime = blob.type || 'audio/webm';
    const ext = mime.includes('ogg') ? 'ogg' : mime.includes('mp4') || mime.includes('m4a') ? 'm4a' : mime.includes('mpeg') ? 'mp3' : 'webm';
    const path = `${conversacionId}/${crypto.randomUUID()}-voz.${ext}`;
    const { error: upErr } = await this.supabase.client.storage
      .from('sgc-mensajes')
      .upload(path, blob, { contentType: mime });
    if (upErr) throw new Error(upErr.message);

    const { data: id, error } = await this.supabase.client.rpc('enviar_nota_voz', {
      p_conversacion_id: conversacionId,
      p_archivo_path: path,
      p_duracion_seg: Math.max(0, Math.round(duracionSeg)),
      p_archivo_mime: mime,
      p_client_id: clientId,
    });
    if (error) throw new Error(error.message);

    const { data: row, error: selErr } = await this.supabase.client
      .from('mensajes')
      .select('*, autor:usuarios(nombre)')
      .eq('id', id as string)
      .single();
    if (selErr) throw new Error(selErr.message);
    return row as unknown as Mensaje;
  }

  async getArchivoUrl(path: string): Promise<string> {
    const { data, error } = await this.supabase.client.storage.from('sgc-mensajes').createSignedUrl(path, 3600);
    if (error) throw new Error(error.message);
    return data.signedUrl;
  }

  /**
   * AT15 — URL firmada (cacheada) de un THUMBNAIL para previsualizar imágenes
   * adjuntas inline en el hilo (estilo WhatsApp). Devuelve '' si el path es
   * vacío o si la firma falla (nunca lanza). La original a tamaño completo se
   * obtiene con `getArchivoUrl` al abrir el lightbox.
   */
  async getThumbUrl(path: string): Promise<string> {
    return this.signedUrls.signed('sgc-mensajes', path, { width: 480, height: 480, quality: 70 });
  }

  async crearDirecta(otroUsuarioId: string): Promise<string> {
    const { data, error } = await this.supabase.client.rpc('crear_conversacion_directa', { p_otro: otroUsuarioId });
    if (error) throw new Error(error.message);
    return data as string;
  }

  async crearGrupo(nombre: string, participantes: string[]): Promise<string> {
    const { data, error } = await this.supabase.client.rpc('crear_grupo', {
      p_nombre: nombre,
      p_participantes: participantes,
    });
    if (error) throw new Error(error.message);
    return data as string;
  }

  // ── Gestión de grupos (RPCs, permisos forzados en el servidor) ──────────
  /** Ficha completa del grupo: datos, mi rol y participantes con su rol. */
  async grupoInfo(conv: string): Promise<GrupoInfo> {
    const { data, error } = await this.supabase.client.rpc('grupo_info', { p_conv: conv });
    if (error) throw new Error(error.message);
    return data as GrupoInfo;
  }

  /** Edita nombre y descripción del grupo (solo admin). */
  async grupoEditar(conv: string, nombre: string, descripcion: string): Promise<void> {
    const { error } = await this.supabase.client.rpc('grupo_editar', {
      p_conv: conv,
      p_nombre: nombre,
      p_descripcion: descripcion,
    });
    if (error) throw new Error(error.message);
  }

  /** Agrega un participante al grupo (solo admin). */
  async grupoAgregar(conv: string, usuarioId: string): Promise<void> {
    const { error } = await this.supabase.client.rpc('grupo_agregar', {
      p_conv: conv,
      p_usuario_id: usuarioId,
    });
    if (error) throw new Error(error.message);
  }

  /** Quita un participante del grupo (solo admin; no puede ser el creador). */
  async grupoQuitar(conv: string, usuarioId: string): Promise<void> {
    const { error } = await this.supabase.client.rpc('grupo_quitar', {
      p_conv: conv,
      p_usuario_id: usuarioId,
    });
    if (error) throw new Error(error.message);
  }

  /** Promueve o degrada a un participante como admin (solo admin). */
  async grupoPromover(conv: string, usuarioId: string, admin: boolean): Promise<void> {
    const { error } = await this.supabase.client.rpc('grupo_promover', {
      p_conv: conv,
      p_usuario_id: usuarioId,
      p_admin: admin,
    });
    if (error) throw new Error(error.message);
  }

  /** El usuario actual abandona el grupo. */
  async grupoSalir(conv: string): Promise<void> {
    const { error } = await this.supabase.client.rpc('grupo_salir', { p_conv: conv });
    if (error) throw new Error(error.message);
  }

  /**
   * Sube una nueva foto de grupo al bucket `sgc-mensajes` (primer segmento = id
   * de la conversación, exigido por el RLS de Storage) y la fija vía
   * `grupo_set_avatar`. Devuelve el path guardado.
   */
  async subirAvatarGrupo(conv: string, file: File): Promise<string> {
    const path = `${conv}/avatar/${crypto.randomUUID()}.jpg`;
    const { error: upErr } = await this.supabase.client.storage
      .from('sgc-mensajes')
      .upload(path, file, { upsert: true, contentType: file.type || 'image/jpeg' });
    if (upErr) throw new Error(upErr.message);
    const { error } = await this.supabase.client.rpc('grupo_set_avatar', { p_conv: conv, p_path: path });
    if (error) throw new Error(error.message);
    return path;
  }

  /** URL firmada (cacheada) para el avatar del grupo, o null si no hay path. */
  async getAvatarUrl(path: string | null | undefined): Promise<string | null> {
    if (!path) return null;
    const url = await this.signedUrls.signed('sgc-mensajes', path, { width: 160, height: 160, quality: 75 });
    return url || null;
  }

  /** Directorio de usuarios con detalle (para el selector de agregar participante). */
  async getDirectorioDetalle(): Promise<
    { id: string; nombre: string; email: string; avatar_path: string | null; activo: boolean; roles: string[] }[]
  > {
    const { data, error } = await this.supabase.client.rpc('directorio_usuarios_detalle');
    if (error) throw new Error(error.message);
    return (data ?? []) as {
      id: string;
      nombre: string;
      email: string;
      avatar_path: string | null;
      activo: boolean;
      roles: string[];
    }[];
  }

  async marcarLeido(conversacionId: string, miId: string): Promise<void> {
    const { error } = await this.supabase.client
      .from('conversacion_participantes')
      .update({ last_read_at: new Date().toISOString() })
      .eq('conversacion_id', conversacionId)
      .eq('usuario_id', miId);
    if (error) throw new Error(error.message);
  }

  async contarNoLeidos(): Promise<number> {
    const { data, error } = await this.supabase.client.rpc('contar_mensajes_no_leidos');
    if (error) throw new Error(error.message);
    return (data as number) ?? 0;
  }

  // ── Stickers (AT16) ─────────────────────────────────────
  /**
   * URL usable en un <img src> para una ref de sticker. Si la ref es un asset
   * empaquetado ('assets/…') se devuelve tal cual; si no, se construye la URL
   * pública del bucket `sgc-stickers`.
   */
  stickerUrl(ref: string): string {
    return ref.startsWith('assets/')
      ? ref
      : `${environment.supabaseUrl}/storage/v1/object/public/sgc-stickers/${ref}`;
  }

  /** Packs de stickers del usuario (sistema + propios) con sus stickers. */
  async getMisStickers(): Promise<StickerPack[]> {
    const { data, error } = await this.supabase.client.rpc('mis_stickers');
    if (error) throw new Error(error.message);
    return (data ?? []) as StickerPack[];
  }

  /** Refs de los stickers usados más recientemente (más reciente primero). */
  async getStickersRecientes(limite = 24): Promise<string[]> {
    const { data, error } = await this.supabase.client.rpc('stickers_recientes', { p_limite: limite });
    if (error) throw new Error(error.message);
    return ((data ?? []) as { ref: string; used_at: string }[]).map((r) => r.ref);
  }

  /**
   * Envía un sticker como mensaje: inserta la fila (ref en `archivo_path`,
   * tipo 'sticker') y registra la ref como reciente. Realtime lo entrega como
   * cualquier otro mensaje.
   */
  async enviarSticker(conversacionId: string, autorId: string, ref: string): Promise<void> {
    const { error } = await this.supabase.client.from('mensajes').insert({
      conversacion_id: conversacionId,
      autor_id: autorId,
      contenido: null,
      archivo_path: ref,
      archivo_mime: 'image/sticker',
      tipo: 'sticker',
    });
    if (error) throw new Error(error.message);
    await this.supabase.client.rpc('registrar_sticker_reciente', { p_ref: ref });
  }

  /**
   * Sube una imagen como sticker propio del usuario al bucket público
   * `sgc-stickers` (primer segmento = id del usuario, exigido por el RLS de
   * Storage) y la registra vía `agregar_sticker`. Si no se indica pack, va al
   * pack automático "Mis stickers".
   */
  async subirSticker(usuarioId: string, file: File, packId?: string): Promise<void> {
    const ext = (file.name.split('.').pop() || 'webp').toLowerCase();
    const path = `${usuarioId}/${crypto.randomUUID()}.${ext}`;
    const { error: upErr } = await this.supabase.client.storage
      .from('sgc-stickers')
      .upload(path, file, { upsert: false, contentType: file.type });
    if (upErr) throw new Error(upErr.message);
    const { error } = await this.supabase.client.rpc('agregar_sticker', {
      p_storage_path: path,
      p_pack_id: packId ?? null,
    });
    if (error) throw new Error(error.message);
  }

  /** Crea un pack de stickers propio y devuelve su id. */
  async crearPackSticker(nombre: string): Promise<string> {
    const { data, error } = await this.supabase.client.rpc('crear_pack_sticker', { p_nombre: nombre });
    if (error) throw new Error(error.message);
    return data as string;
  }

  /** Elimina un sticker propio. */
  async eliminarSticker(stickerId: string): Promise<void> {
    const { error } = await this.supabase.client.rpc('eliminar_sticker', { p_sticker_id: stickerId });
    if (error) throw new Error(error.message);
  }

  /** Elimina un pack de stickers propio. */
  async eliminarPackSticker(packId: string): Promise<void> {
    const { error } = await this.supabase.client.rpc('eliminar_pack_sticker', { p_pack_id: packId });
    if (error) throw new Error(error.message);
  }

  /** Live INSERTs across all of the caller's visible conversations (RLS-scoped). */
  subscribeMensajes(onInsert: (m: Mensaje) => void): RealtimeChannel {
    return this.supabase.client
      .channel('mensajes-feed')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'sgc', table: 'mensajes' },
        (payload) => onInsert(payload.new as Mensaje),
      )
      .subscribe();
  }

  async unsubscribe(channel: RealtimeChannel): Promise<void> {
    await this.supabase.client.removeChannel(channel);
  }
}
