import { Injectable, inject } from '@angular/core';
import { RealtimeChannel } from '@supabase/supabase-js';
import { SupabaseService } from '../../app/core/services/supabase.service';
import { Conversacion, Mensaje, ParticipanteInfo } from '../models/mensaje.model';

@Injectable({ providedIn: 'root' })
export class MensajeriaService {
  private supabase = inject(SupabaseService);

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
      .select('*, autor:usuarios(nombre)')
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

  async getArchivoUrl(path: string): Promise<string> {
    const { data, error } = await this.supabase.client.storage.from('sgc-mensajes').createSignedUrl(path, 3600);
    if (error) throw new Error(error.message);
    return data.signedUrl;
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
