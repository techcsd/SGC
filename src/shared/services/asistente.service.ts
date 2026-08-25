import { Injectable, inject, signal } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';

/** AW4 — un turno de conversación con Tato (rol + texto + herramientas usadas). */
export interface AsistenteMensaje {
  rol: 'user' | 'assistant';
  contenido: string;
  herramientas?: { tool: string; ok: boolean }[] | null;
  created_at?: string; // AY11a — para mostrar hora/fecha del mensaje
}

export interface AsistenteConversacion {
  id: string;
  titulo: string | null;
  updated_at: string;
}

/** AW4 v2 — borrador de acción que el usuario debe confirmar antes de ejecutar. */
export interface AsistentePropuesta {
  tipo: 'tarea' | 'requisicion' | 'conduce';
  tool: string;
  params: Record<string, unknown>;
  titulo: string;
  lineas: string[];
}

export interface AsistenteRespuesta {
  conversacion_id: string;
  respuesta: string;
  herramientas: { tool: string; ok: boolean }[];
  propuesta?: AsistentePropuesta | null;
  ejecutado?: boolean;
  /** AY11/C2 — archivo generado (PDF) listo para descargar. */
  archivo?: { nombre: string; url: string } | null;
}

/**
 * AW4 — cliente del asistente "Tato". Toda la inteligencia vive en la edge
 * function `assistant` (Claude + tool use), que ejecuta las herramientas con
 * el JWT del usuario (RLS aplica sola). Aquí solo invocamos y leemos historial.
 */
@Injectable({ providedIn: 'root' })
export class AsistenteService {
  private supabase = inject(SupabaseService);

  // ── AY10 — estado del panel que sobrevive la navegación ───────────────────
  // El servicio es singleton (providedIn: root), así que estos signals viven
  // aunque el componente se destruya al navegar. localStorage es el respaldo
  // ligero para sobrevivir un refresh (patrón AE9 mini). El borrador se guarda
  // POR conversación ('nueva' = conversación aún sin id).
  private readonly KEY_OPEN = 'compa.openConv';
  private readonly KEY_DRAFTS = 'compa.drafts';
  readonly openConversacionId = signal<string | null>(this.leerOpen());
  private drafts = signal<Record<string, string>>(this.leerDrafts());

  private leerOpen(): string | null {
    try { return localStorage.getItem(this.KEY_OPEN) || null; } catch { return null; }
  }
  private leerDrafts(): Record<string, string> {
    try { return JSON.parse(localStorage.getItem(this.KEY_DRAFTS) || '{}'); } catch { return {}; }
  }
  setOpen(id: string | null) {
    this.openConversacionId.set(id);
    try { id ? localStorage.setItem(this.KEY_OPEN, id) : localStorage.removeItem(this.KEY_OPEN); } catch { /* ignore */ }
  }
  getDraft(convKey: string | null): string {
    return this.drafts()[convKey ?? 'nueva'] ?? '';
  }
  setDraft(convKey: string | null, texto: string) {
    const key = convKey ?? 'nueva';
    const next = { ...this.drafts() };
    if (texto) next[key] = texto; else delete next[key];
    this.drafts.set(next);
    try { localStorage.setItem(this.KEY_DRAFTS, JSON.stringify(next)); } catch { /* ignore */ }
  }

  /** Envía un mensaje y devuelve la respuesta del asistente (+ conversación + propuesta). */
  async enviar(mensaje: string, conversacionId: string | null): Promise<AsistenteRespuesta> {
    return this.invocar({ mensaje, conversacion_id: conversacionId });
  }

  /** AW4 v2 — ejecuta una acción previamente PREPARADA, tras la confirmación del usuario. */
  async ejecutar(propuesta: AsistentePropuesta, conversacionId: string | null): Promise<AsistenteRespuesta> {
    return this.invocar({ ejecutar: propuesta, conversacion_id: conversacionId });
  }

  private async invocar(body: Record<string, unknown>): Promise<AsistenteRespuesta> {
    const { data, error } = await this.supabase.client.functions.invoke('assistant', { body });
    if (error) {
      let msg = error.message || 'No se pudo contactar al asistente.';
      try {
        const ctx = (error as unknown as { context?: Response }).context;
        if (ctx && typeof ctx.json === 'function') {
          const b = await ctx.json();
          if (b?.error) msg = b.error;
        }
      } catch { /* deja el mensaje por defecto */ }
      throw new Error(msg);
    }
    return data as AsistenteRespuesta;
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
      created_at: (m as { created_at: string }).created_at,
    }));
  }
}
