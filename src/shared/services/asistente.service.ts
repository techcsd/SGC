import { Injectable, inject, signal } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';
import { invokeEdge } from '../utils/edge.util';
import { APP_VERSION } from '../../environments/version';

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
  tipo: 'tarea' | 'requisicion' | 'conduce' | 'ruta' | 'echada_formulario';
  tool: string;
  params: Record<string, unknown>;
  titulo: string;
  lineas: string[];
  /** BB3 — clave de idempotencia de la acción (para no duplicar al confirmar). */
  idem?: string;
  /** BB3 — la acción saldrá marcada de prueba por propagación (obra/almacén test). */
  es_prueba?: boolean;
  /** BB3 — texto del aviso de prueba, para mostrarlo antes de confirmar. */
  aviso_prueba?: string | null;
  /** CV1 — 'abrir': la propuesta NO se confirma aquí, navega a un formulario
   *  real con `destino.query` como queryParams; no hay botón "Confirmar". Sin
   *  este campo (u otro valor), el comportamiento de siempre (Confirmar/Cancelar). */
  accion?: 'abrir';
  /** CV1 — a dónde navegar y con qué queryParams, cuando accion==='abrir'. */
  destino?: { vehiculo_id: string; query: Record<string, string | number> };
  /** CV1 — qué le falta a la propuesta (p. ej. fotos, odómetro) — se muestra como aviso. */
  faltan?: string[];
}

export interface AsistenteRespuesta {
  conversacion_id: string;
  respuesta: string;
  herramientas: { tool: string; ok: boolean }[];
  propuesta?: AsistentePropuesta | null;
  ejecutado?: boolean;
  /** AY11/C2 — compat: el primero de `archivos` (o null). Preferir `archivos`. */
  archivo?: { nombre: string; url: string } | null;
  /** CP3/CP9 — uno o varios archivos generados (PDF/Excel) listos para descargar. */
  archivos?: { nombre: string; url: string }[];
}

/** BA3 — chips + saludo de Compa por rol (fuente única en BD: sgc.compa_chips). */
export interface CompaSugerencias {
  chips: string[];
  saludo: string | null;
  subtitulo: string | null;
  persona: string;
}

/** CP2 — una conversación que alguien compartió conmigo. */
export interface CompaCompartida {
  id: string;
  conversacion_id: string;
  titulo: string | null;
  compartida_por_nombre: string;
  mensaje: string | null;
  created_at: string;
  vista_at: string | null;
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

  // DB7 — antes esto lanzaba `error.message` tal cual, y un fallo de transporte
  // (worker frío/timeout/red: la petición nunca recibe respuesta con CORS) le
  // mostraba al usuario la jerga de supabase-js «Failed to send a request to the
  // Edge Function» (regla 16). Ahora pasa por `invokeEdge` (CG5): reintenta UNA
  // vez a los 1.5 s en fallo de transporte, traduce a mensaje humano por tipo, y
  // registra la firma `compa_transporte` en sgc (panel Reportes de errores).
  private async invocar(body: Record<string, unknown>): Promise<AsistenteRespuesta> {
    return invokeEdge<AsistenteRespuesta>(this.supabase.client, 'assistant', body, {
      retries: 1,
      retryDelayMs: 1500,
      onTransporte: (detalle) => void this.registrarFalloTransporte(detalle),
    });
  }

  /** DB7 — deja el fallo de transporte de Compa visible en Tecnología › Errores
   *  (AT11: si Compa falla y no queda rastro, el bug es invisible). Anti-loop:
   *  mejor-esfuerzo, nunca lanza. */
  private async registrarFalloTransporte(detalle: string): Promise<void> {
    try {
      await this.supabase.client.rpc('report_app_error', {
        p_error_type: 'error',
        p_message: `compa_transporte: ${detalle}`.slice(0, 500),
        p_stack: null,
        p_context: { url: location.pathname },
        p_device_brand: null,
        p_device_model: 'Navegador',
        p_os_version: navigator.userAgent.slice(0, 60),
        p_app_version: APP_VERSION,
        p_platform: 'web',
        p_source: 'web',
      });
    } catch { /* nunca romper Compa por el registro */ }
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

  /** BA3 — chips + saludo/subtítulo de Compa según el rol del usuario (fuente única BD). */
  async sugerenciasPorRol(): Promise<CompaSugerencias> {
    const { data, error } = await this.supabase.client.rpc('compa_sugerencias');
    const rows = (error ? [] : (data ?? [])) as { texto: string; saludo: string | null; subtitulo: string | null; persona: string }[];
    return {
      chips: rows.map((r) => r.texto),
      saludo: rows[0]?.saludo ?? null,
      subtitulo: rows[0]?.subtitulo ?? null,
      persona: rows[0]?.persona ?? 'default',
    };
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

  // ── CP2 — compartir conversaciones ─────────────────────────────────────────

  /** Comparte una conversación mía con uno o varios usuarios. */
  async compartir(conversacionId: string, usuarios: string[], mensaje: string | null): Promise<void> {
    const { error } = await this.supabase.client.rpc('compa_compartir', {
      p_conversacion: conversacionId, p_usuarios: usuarios, p_mensaje: mensaje || null,
    });
    if (error) throw new Error(error.message);
  }

  /** Conversaciones que otros compartieron conmigo. */
  async compartidasConmigo(): Promise<CompaCompartida[]> {
    const { data, error } = await this.supabase.client.rpc('compa_compartidas_conmigo');
    if (error) return [];
    return (data ?? []) as CompaCompartida[];
  }

  /** Mensajes de una conversación compartida conmigo (solo lectura). */
  async conversacionCompartida(compartidaId: string): Promise<AsistenteMensaje[]> {
    const { data, error } = await this.supabase.client.rpc('compa_conversacion_compartida', { p_id: compartidaId });
    if (error) throw new Error(error.message);
    return ((data ?? []) as { rol: string; contenido: string; herramientas: { tool: string; ok: boolean }[] | null; created_at: string }[])
      .map((m) => ({
        rol: m.rol === 'assistant' ? 'assistant' : 'user',
        contenido: m.contenido,
        herramientas: m.herramientas,
        created_at: m.created_at,
      }));
  }
}
