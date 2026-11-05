import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';
import { environment } from '../../environments/environment';
import { WaChatImportMensaje } from '../utils/wa-chat-import.util';

/**
 * DB-S6/DB-S10 — "WhatsApp: memoria de grupos" (Tecnología). Backend construido
 * esta ronda por otros agentes (edges `wa-ingest`/`wa-extract`, listener externo
 * `csd-wa-listener`) — ver sql/2026-11-05-db2-whatsapp-grupos.sql. Este servicio
 * es SOLO la capa de lectura/CRUD web que alimenta la pestaña `Tecnología ›
 * Compa en WhatsApp` (extiende whatsapp.ts, DC7). NO toca el canal 1:1 (round
 * DC, `WhatsappCompaService`) — son tablas y pantallas distintas.
 */

export type WaGrupoModo = 'memoria' | 'consulta' | 'ignorar';

export interface WaGrupo {
  jid: string;
  nombre: string;
  modo: WaGrupoModo;
  participantes: number | null;
  proyecto_id: string | null;
  aviso_enviado_en: string | null;
  primer_mensaje_en: string | null;
  ultimo_mensaje_en: string | null;
  creado_en: string;
  actualizado_en: string;
  /** Calculado en el cliente (no es columna) a partir de wa_mensajes_grupo. */
  mensajes_24h: number;
  mensajes_7d: number;
}

interface WaGrupoRow {
  jid: string;
  nombre: string;
  modo: WaGrupoModo;
  participantes: number | null;
  proyecto_id: string | null;
  aviso_enviado_en: string | null;
  primer_mensaje_en: string | null;
  ultimo_mensaje_en: string | null;
  creado_en: string;
  actualizado_en: string;
}

export type WaMensajeTipo =
  | 'texto' | 'audio' | 'imagen' | 'documento' | 'video' | 'sticker' | 'ubicacion' | 'contacto' | 'otro';

export interface WaMensajeGrupo {
  id: string;
  wa_message_id: string;
  grupo_jid: string;
  autor_telefono: string;
  autor_nombre: string | null;
  usuario_id: string | null;
  tipo: WaMensajeTipo;
  texto: string | null;
  transcripcion: string | null;
  media_ref: string | null;
  media_mime: string | null;
  descripcion_media: string | null;
  reply_to_id: string | null;
  menciona_bot: boolean;
  enviado_en: string;
  recibido_en: string;
  procesado: boolean;
  procesado_en: string | null;
}

export interface WaMensajeBusqueda {
  id: string;
  grupo_jid: string;
  grupo_nombre: string;
  autor_nombre: string | null;
  autor_telefono: string;
  tipo: WaMensajeTipo;
  fragmento: string;
  enviado_en: string;
}

export interface WaBusquedaFiltro {
  consulta: string;
  grupo_jid?: string | null;
  desde?: string | null; // YYYY-MM-DD
  hasta?: string | null; // YYYY-MM-DD
  limite?: number;
}

export type WaHallazgoTipo =
  | 'acuerdo' | 'tarea' | 'pedido_material' | 'incidente' | 'decision' | 'monto'
  | 'fecha_limite' | 'cambio_de_plan' | 'pregunta_abierta' | 'contacto' | 'otro';
export type WaHallazgoEstado = 'nuevo' | 'revisado' | 'descartado' | 'convertido';

export interface WaHallazgo {
  id: string;
  grupo_jid: string;
  grupo_nombre: string;
  tipo: WaHallazgoTipo;
  resumen: string;
  detalle: string | null;
  fecha_mencionada: string | null;
  monto: number | null;
  moneda: string | null;
  confianza: number | null;
  estado: WaHallazgoEstado;
  creado_en: string;
  /** Solo se llena cuando se consulta el detalle (no viene en el listado RPC). */
  personas?: { nombre?: string; telefono?: string }[];
  mensaje_ids?: string[];
}

export interface WaHallazgosFiltro {
  grupo_jid?: string | null;
  tipo?: string | null;
  estado?: string | null;
  desde?: string | null;
  hasta?: string | null;
  limite?: number;
}

export interface WaListenerEstado {
  host: string;
  estado: 'conectado' | 'esperando_qr' | 'desconectado' | 'sesion_cerrada' | 'posible_baneo';
  libreria: string | null;
  version: string | null;
  cola_pendiente: number | null;
  ultimo_latido_en: string;
  ultimo_mensaje_en: string | null;
  mensajes_enviados_24h: number | null;
  reconexiones_24h: number | null;
  detalle: Record<string, unknown>;
}

export interface WaEvento {
  id: string;
  nivel: 'info' | 'alerta' | 'critico';
  codigo: string;
  detalle: Record<string, unknown>;
  creado_en: string;
}

export interface WaUsoIaDia {
  fecha: string;
  funcion: string;
  llamadas: number;
  tokens_in: number;
  tokens_out: number;
  costo_estimado: number;
}

export interface WaConfig {
  modo_por_defecto: WaGrupoModo;
  dm_habilitado: boolean;
  intervalo_heartbeat_s: number;
  max_respuestas_grupo_hora: number;
  texto_aviso_grupo: string;
  budget_tokens_dia: number | null;
  actualizado_en: string;
}

@Injectable({ providedIn: 'root' })
export class WaGruposService {
  private supabase = inject(SupabaseService);

  // ── Grupos ───────────────────────────────────────────────────────────────
  /** Lista directa de la tabla (no el RPC `wa_grupos_listar`, pensado para
   *  Compa/MCP): esta pantalla necesita columnas que el RPC no expone
   *  (aviso_enviado_en) y además actualiza filas, para lo que el RPC no sirve. */
  async listarGrupos(): Promise<WaGrupo[]> {
    const [gruposRes, actividadRes] = await Promise.all([
      this.supabase.client.from('wa_grupos').select('*').order('ultimo_mensaje_en', { ascending: false, nullsFirst: false }),
      // Actividad calculada en el cliente: una sola lectura de los últimos 7 días
      // de TODOS los grupos (volumen interno, acotado) en vez de una RPC nueva.
      this.supabase.client
        .from('wa_mensajes_grupo')
        .select('grupo_jid, enviado_en')
        .gte('enviado_en', new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString())
        .limit(5000),
    ]);
    if (gruposRes.error) throw gruposRes.error;
    if (actividadRes.error) throw actividadRes.error;

    const desde24h = Date.now() - 24 * 3600 * 1000;
    const conteo24 = new Map<string, number>();
    const conteo7 = new Map<string, number>();
    for (const m of (actividadRes.data ?? []) as { grupo_jid: string; enviado_en: string }[]) {
      conteo7.set(m.grupo_jid, (conteo7.get(m.grupo_jid) ?? 0) + 1);
      if (new Date(m.enviado_en).getTime() >= desde24h) {
        conteo24.set(m.grupo_jid, (conteo24.get(m.grupo_jid) ?? 0) + 1);
      }
    }
    return ((gruposRes.data ?? []) as WaGrupoRow[]).map((g) => ({
      ...g,
      mensajes_24h: conteo24.get(g.jid) ?? 0,
      mensajes_7d: conteo7.get(g.jid) ?? 0,
    }));
  }

  async actualizarGrupo(jid: string, patch: { modo?: WaGrupoModo; proyecto_id?: string | null }): Promise<void> {
    const { error } = await this.supabase.client.from('wa_grupos').update(patch).eq('jid', jid);
    if (error) throw error;
  }

  // ── Hallazgos ────────────────────────────────────────────────────────────
  async listarHallazgos(f: WaHallazgosFiltro): Promise<WaHallazgo[]> {
    const { data, error } = await this.supabase.client.rpc('wa_hallazgos_listar', {
      p_grupo_jid: f.grupo_jid || null,
      p_tipo: f.tipo || null,
      p_estado: f.estado || null,
      p_desde: f.desde || null,
      p_hasta: f.hasta || null,
      p_limite: f.limite ?? 50,
    });
    if (error) throw error;
    return (data ?? []) as WaHallazgo[];
  }

  /** Detalle completo (personas + mensaje_ids), que el listado RPC no trae. */
  async detalleHallazgo(id: string): Promise<{ personas: { nombre?: string; telefono?: string }[]; mensaje_ids: string[] }> {
    const { data, error } = await this.supabase.client
      .from('wa_hallazgos')
      .select('personas, mensaje_ids')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    const row = data as { personas: { nombre?: string; telefono?: string }[] | null; mensaje_ids: string[] | null } | null;
    return { personas: row?.personas ?? [], mensaje_ids: row?.mensaje_ids ?? [] };
  }

  /** `personas` de un LOTE de hallazgos en una sola consulta (evita N+1 al
   *  filtrar el inbox por persona — el listado RPC no trae esta columna). */
  async personasDeHallazgos(ids: string[]): Promise<Record<string, { nombre?: string; telefono?: string }[]>> {
    if (!ids.length) return {};
    const { data, error } = await this.supabase.client.from('wa_hallazgos').select('id, personas').in('id', ids);
    if (error) throw error;
    const out: Record<string, { nombre?: string; telefono?: string }[]> = {};
    for (const row of (data ?? []) as { id: string; personas: { nombre?: string; telefono?: string }[] | null }[]) {
      out[row.id] = row.personas ?? [];
    }
    return out;
  }

  async mensajesPorIds(ids: string[]): Promise<WaMensajeGrupo[]> {
    if (!ids.length) return [];
    const { data, error } = await this.supabase.client
      .from('wa_mensajes_grupo')
      .select('*')
      .in('id', ids)
      .order('enviado_en', { ascending: true });
    if (error) throw error;
    return (data ?? []) as WaMensajeGrupo[];
  }

  async actualizarHallazgo(
    id: string,
    patch: { estado?: WaHallazgoEstado; resumen?: string; detalle?: string | null; convertido_a?: string | null },
  ): Promise<void> {
    const { error } = await this.supabase.client.from('wa_hallazgos').update(patch).eq('id', id);
    if (error) throw error;
  }

  // ── Archivo (búsqueda) ───────────────────────────────────────────────────
  async buscarMensajes(f: WaBusquedaFiltro): Promise<WaMensajeBusqueda[]> {
    const { data, error } = await this.supabase.client.rpc('wa_mensajes_grupo_buscar', {
      p_consulta: f.consulta,
      p_grupo_jid: f.grupo_jid || null,
      p_desde: f.desde ? `${f.desde}T00:00:00` : null,
      p_hasta: f.hasta ? `${f.hasta}T23:59:59` : null,
      p_limite: f.limite ?? 20,
    });
    if (error) throw error;
    return (data ?? []) as WaMensajeBusqueda[];
  }

  async detalleMensaje(id: string): Promise<WaMensajeGrupo | null> {
    const { data, error } = await this.supabase.client.from('wa_mensajes_grupo').select('*').eq('id', id).maybeSingle();
    if (error) throw error;
    return data as WaMensajeGrupo | null;
  }

  // ── Estado ───────────────────────────────────────────────────────────────
  async listenerEstado(): Promise<WaListenerEstado[]> {
    const { data, error } = await this.supabase.client.from('wa_listener_estado').select('*').order('host');
    if (error) throw error;
    return (data ?? []) as WaListenerEstado[];
  }

  async eventosRecientes(limite = 20): Promise<WaEvento[]> {
    const { data, error } = await this.supabase.client
      .from('wa_eventos')
      .select('*')
      .order('creado_en', { ascending: false })
      .limit(limite);
    if (error) throw error;
    return (data ?? []) as WaEvento[];
  }

  async usoIaDiario(desde?: string | null, hasta?: string | null): Promise<WaUsoIaDia[]> {
    const { data, error } = await this.supabase.client.rpc('wa_uso_ia_diario', {
      p_desde: desde || null,
      p_hasta: hasta || null,
    });
    if (error) throw error;
    return (data ?? []) as WaUsoIaDia[];
  }

  async configGlobal(): Promise<WaConfig | null> {
    const { data, error } = await this.supabase.client.from('wa_config').select('*').eq('id', true).maybeSingle();
    if (error) throw error;
    return data as WaConfig | null;
  }

  /** `GET wa-ingest?modo=estado` — booleans de qué secretos están configurados
   *  (nunca el valor), mismo patrón que `whatsapp-webhook?modo=estado` (DC7).
   *  Gate propio: `puede_ver_submodulo('tecnologia.wa_grupos')` (server). */
  async secretosEstado(): Promise<Record<string, boolean>> {
    const { data: sesion } = await this.supabase.client.auth.getSession();
    const token = sesion.session?.access_token;
    if (!token) throw new Error('Sesión inválida');
    const res = await fetch(`${environment.supabaseUrl}/functions/v1/wa-ingest?modo=estado`, {
      headers: { Authorization: `Bearer ${token}`, apikey: environment.supabaseAnonKey },
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json?.error ?? 'No se pudo consultar el estado de los secretos.');
    return json.secretos as Record<string, boolean>;
  }

  /** `GET wa-ingest?modo=media&wa_message_id=X` — URL firmada de corta duración
   *  (300s) para previsualizar un adjunto del bucket privado `wa-media`. El
   *  front NUNCA accede al bucket directo (sin policies de cliente). */
  async urlMedia(waMessageId: string): Promise<{ url: string; mime: string | null }> {
    const { data: sesion } = await this.supabase.client.auth.getSession();
    const token = sesion.session?.access_token;
    if (!token) throw new Error('Sesión inválida');
    const res = await fetch(`${environment.supabaseUrl}/functions/v1/wa-ingest?modo=media&wa_message_id=${encodeURIComponent(waMessageId)}`, {
      headers: { Authorization: `Bearer ${token}`, apikey: environment.supabaseAnonKey },
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json?.error ?? 'No se pudo generar la vista previa.');
    return { url: json.url as string, mime: (json.mime as string | null) ?? null };
  }

  // ── DB-S10 — importar historial (.txt) ──────────────────────────────────
  /**
   * RPC `sgc.wa_importar_mensajes(p_grupo_jid text, p_mensajes jsonb) returns
   * integer` (agregada en sql/2026-11-05-db2-whatsapp-grupos.sql §15, admin-only
   * vía `is_admin()`, idempotente por `wa_message_id := id_import` con
   * `on conflict do nothing` — reintentar el mismo archivo no duplica).
   * Confirmada con una prueba real simulando un JWT de admin en una
   * transacción con rollback: 1.ª llamada insertó 2 filas, reimportar el
   * mismo contenido insertó 0.
   */
  async importarMensajes(grupoJid: string, mensajes: WaChatImportMensaje[]): Promise<number> {
    const { data, error } = await this.supabase.client.rpc('wa_importar_mensajes', {
      p_grupo_jid: grupoJid,
      p_mensajes: mensajes.map((m) => ({
        id_import: m.idImport,
        autor_nombre: m.autorNombre,
        autor_telefono: m.autorTelefono,
        tipo: m.tipo,
        texto: m.texto,
        enviado_en: m.enviadoEn,
      })),
    });
    if (error) throw error;
    return (data as number | null) ?? 0;
  }
}
