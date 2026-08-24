import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';

/** AW4 — un turno de conversación con Tato (rol + texto + herramientas usadas). */
export interface AsistenteMensaje {
  rol: 'user' | 'assistant';
  contenido: string;
  herramientas?: { tool: string; ok: boolean }[] | null;
}

export interface AsistenteConversacion {
  id: string;
  titulo: string | null;
  updated_at: string;
}

/**
 * AW4 — cliente del asistente "Tato". Toda la inteligencia vive en la edge
 * function `assistant` (Claude + tool use), que ejecuta las herramientas con
 * el JWT del usuario (RLS aplica sola). Aquí solo invocamos y leemos historial.
 */
@Injectable({ providedIn: 'root' })
export class AsistenteService {
  private supabase = inject(SupabaseService);

  /** Envía un mensaje y devuelve la respuesta del asistente (+ conversación). */
  async enviar(
    mensaje: string,
    conversacionId: string | null,
  ): Promise<{ conversacion_id: string; respuesta: string; herramientas: { tool: string; ok: boolean }[] }> {
    const { data, error } = await this.supabase.client.functions.invoke('assistant', {
      body: { mensaje, conversacion_id: conversacionId },
    });
    if (error) {
      // Intenta leer el mensaje de error real que devolvió la edge function.
      let msg = error.message || 'No se pudo contactar al asistente.';
      try {
        const ctx = (error as unknown as { context?: Response }).context;
        if (ctx && typeof ctx.json === 'function') {
          const body = await ctx.json();
          if (body?.error) msg = body.error;
        }
      } catch { /* deja el mensaje por defecto */ }
      throw new Error(msg);
    }
    return data as { conversacion_id: string; respuesta: string; herramientas: { tool: string; ok: boolean }[] };
  }

  /** Conversaciones recientes del usuario (RLS: solo las suyas). */
  async conversacionesRecientes(): Promise<AsistenteConversacion[]> {
    const { data } = await this.supabase.client
      .from('assistant_conversaciones')
      .select('id, titulo, updated_at')
      .order('updated_at', { ascending: false })
      .limit(20);
    return (data ?? []) as AsistenteConversacion[];
  }

  /** Mensajes de una conversación (para retomarla). */
  async mensajes(conversacionId: string): Promise<AsistenteMensaje[]> {
    const { data } = await this.supabase.client
      .from('assistant_mensajes')
      .select('rol, contenido, herramientas, created_at')
      .eq('conversacion_id', conversacionId)
      .order('created_at', { ascending: true });
    return (data ?? []).map((m) => ({
      rol: (m as { rol: string }).rol === 'assistant' ? 'assistant' : 'user',
      contenido: (m as { contenido: string }).contenido,
      herramientas: (m as { herramientas: { tool: string; ok: boolean }[] | null }).herramientas,
    }));
  }
}
