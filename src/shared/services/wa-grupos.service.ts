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
  /** DL3 — a quién recordarle los hallazgos de este grupo cuando no hay mención única. */
  responsables: string[];
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
  responsables: string[] | null;
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

/** DL3 — estado de seguimiento (recordatorios/cierre); `sin` = tipo sin
 *  seguimiento o aún no resuelto a un responsable. */
export type WaSeguimiento = 'sin' | 'activo' | 'resuelto_probable' | 'resuelto' | 'vencido' | 'pausado';

export interface WaHallazgoV2 extends WaHallazgo {
  responsable_id: string | null;
  responsable_nombre: string | null;
  responsable_origen: 'ia' | 'manual' | 'grupo' | 'tecnologia' | null;
  seguimiento: WaSeguimiento;
  seguimiento_desde: string | null;
  recordatorios_enviados: number;
  ultimo_recordatorio_en: string | null;
  convertido_a: string | null;
  convertido_ref_id: string | null;
  total: number;
}

export interface WaHallazgosFiltro {
  grupo_jid?: string | null;
  tipo?: string | null;
  estado?: string | null;
  seguimiento?: WaSeguimiento | null;
  responsable_id?: string | null;
  desde?: string | null;
  hasta?: string | null;
  limite?: number;
  offset?: number;
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

/** DL5 — recap diario/semanal por grupo (pestaña Resúmenes). */
export interface WaResumen {
  id: string;
  grupo_jid: string;
  grupo_nombre: string;
  periodo: 'dia' | 'semana';
  fecha: string;
  desde: string | null;
  hasta: string | null;
  resumen: string | null;
  decisiones: { resumen: string; responsable_nombre?: string | null }[];
  pendientes: { resumen: string; responsable_nombre?: string | null; seguimiento?: string }[];
  mensajes_cubiertos: number;
  pdf_path: string | null;
  creado_en: string;
}

export interface WaConfig {
  modo_por_defecto: WaGrupoModo;
  dm_habilitado: boolean;
  intervalo_heartbeat_s: number;
  max_respuestas_grupo_hora: number;
  texto_aviso_grupo: string;
  budget_tokens_dia: number | null;
  /** DL3/DL-27 */
  recordatorio_whatsapp: boolean;
  recap_minimo_mensajes: number;
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
      responsables: g.responsables ?? [],
      mensajes_24h: conteo24.get(g.jid) ?? 0,
      mensajes_7d: conteo7.get(g.jid) ?? 0,
    }));
  }

  async actualizarGrupo(jid: string, patch: { modo?: WaGrupoModo; proyecto_id?: string | null; responsables?: string[] }): Promise<void> {
    const { error } = await this.supabase.client.from('wa_grupos').update(patch).eq('jid', jid);
    if (error) throw error;
  }

  /** Nombres de un lote de usuarios (chips de responsables/destinatarios en Grupos). */
  async resolverNombres(ids: string[]): Promise<Record<string, string>> {
    if (!ids.length) return {};
    const { data, error } = await this.supabase.client.rpc('resolver_nombres_usuarios', { p_ids: [...new Set(ids)] });
    if (error) throw error;
    const out: Record<string, string> = {};
    for (const row of (data ?? []) as { id: string; nombre: string }[]) out[row.id] = row.nombre;
    return out;
  }

  // ── DL5/F6.1 — destinatarios del recap por grupo ────────────────────────
  async destinatariosRecap(jid: string): Promise<{ usuario_id: string; recap_dia: boolean; recap_semana: boolean }[]> {
    const { data, error } = await this.supabase.client
      .from('wa_grupo_destinatarios')
      .select('usuario_id, recap_dia, recap_semana')
      .eq('grupo_jid', jid);
    if (error) throw error;
    return (data ?? []) as { usuario_id: string; recap_dia: boolean; recap_semana: boolean }[];
  }

  async setDestinatariosRecap(jid: string, usuarios: { usuario_id: string; recap_dia: boolean; recap_semana: boolean }[]): Promise<void> {
    const { error } = await this.supabase.client.rpc('wa_grupo_destinatarios_set', { p_grupo: jid, p_usuarios: usuarios });
    if (error) throw error;
  }

  /** Último recap generado para un grupo (fecha, por pestaña Grupos — "Último recap: …"). */
  async ultimoRecapPorGrupo(): Promise<Record<string, string>> {
    const { data, error } = await this.supabase.client
      .from('wa_resumenes')
      .select('grupo_jid, creado_en')
      .order('creado_en', { ascending: false })
      .limit(500);
    if (error) throw error;
    const out: Record<string, string> = {};
    for (const row of (data ?? []) as { grupo_jid: string; creado_en: string }[]) {
      if (!out[row.grupo_jid]) out[row.grupo_jid] = row.creado_en;
    }
    return out;
  }

  // ── Hallazgos ────────────────────────────────────────────────────────────
  // (la web usa listarHallazgosV2 — wa_hallazgos_listar_v1 sigue viva para
  // Compa/MCP, ver sql/2026-11-10-dl3-wa-seguimiento.sql)

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

  // ── DL3/F6.2 — seguimiento: responsable, estado, convertir real ────────────
  async listarHallazgosV2(f: WaHallazgosFiltro): Promise<WaHallazgoV2[]> {
    const { data, error } = await this.supabase.client.rpc('wa_hallazgos_listar_v2', {
      p_grupo_jid: f.grupo_jid || null,
      p_tipo: f.tipo || null,
      p_estado: f.estado || null,
      p_seguimiento: f.seguimiento || null,
      p_responsable: f.responsable_id || null,
      p_desde: f.desde || null,
      p_hasta: f.hasta || null,
      p_limite: f.limite ?? 30,
      p_offset: f.offset ?? 0,
    });
    if (error) throw error;
    return (data ?? []) as WaHallazgoV2[];
  }

  async asignarResponsable(id: string, responsableId: string | null): Promise<void> {
    const { error } = await this.supabase.client.rpc('wa_hallazgo_asignar', { p_id: id, p_responsable: responsableId });
    if (error) throw error;
  }

  async resolverHallazgo(id: string, motivo?: string): Promise<void> {
    const { error } = await this.supabase.client.rpc('wa_hallazgo_resolver', { p_id: id, p_motivo: motivo ?? null });
    if (error) throw error;
  }

  /** DL-05 — "Convertir" real: para 'tarea' crea la tarea y devuelve su id;
   *  para 'requisicion'/'reunion' solo marca (manual) y devuelve null. */
  async convertirHallazgo(
    id: string, destino: 'tarea' | 'requisicion' | 'reunion', asignadoA?: string | null, fechaLimite?: string | null,
  ): Promise<string | null> {
    const { data, error } = await this.supabase.client.rpc('wa_hallazgo_convertir', {
      p_id: id, p_destino: destino, p_asignado_a: asignadoA ?? null, p_fecha_limite: fechaLimite ?? null,
    });
    if (error) throw error;
    return (data as string | null) ?? null;
  }

  // ── DL5/F6.3 — pestaña Resúmenes ────────────────────────────────────────
  async listarResumenes(f: {
    periodo?: 'dia' | 'semana' | null; grupo_jid?: string | null; desde?: string | null; hasta?: string | null;
    limite?: number; offset?: number;
  }): Promise<{ filas: WaResumen[]; total: number }> {
    const { data, error } = await this.supabase.client.rpc('wa_recap_listar', {
      p_periodo: f.periodo || null, p_grupo: f.grupo_jid || null,
      p_desde: f.desde || null, p_hasta: f.hasta || null,
      p_limit: f.limite ?? 50, p_offset: f.offset ?? 0,
    });
    if (error) throw error;
    const filas = (data ?? []) as (WaResumen & { total: number })[];
    return { filas, total: filas[0]?.total ?? 0 };
  }

  /** URL firmada (300s) para descargar el PDF de un recap — nunca acceso directo al bucket. */
  private async invokeWaRecapGet(qs: string): Promise<Record<string, unknown>> {
    const { data: sesion } = await this.supabase.client.auth.getSession();
    const token = sesion.session?.access_token;
    if (!token) throw new Error('Sesión inválida');
    const res = await fetch(`${environment.supabaseUrl}/functions/v1/wa-recap?${qs}`, {
      headers: { Authorization: `Bearer ${token}`, apikey: environment.supabaseAnonKey },
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json?.error ?? 'No se pudo completar la solicitud.');
    return json;
  }

  async descargarPdfRecap(path: string): Promise<string> {
    const json = await this.invokeWaRecapGet(`modo=pdf&path=${encodeURIComponent(path)}`);
    return json['url'] as string;
  }

  // ── DL-26 — "Probar envío": arma el recordatorio/recap SOLO para quien lo pide ─
  async probarRecordatorio(): Promise<void> {
    const { data, error } = await this.supabase.client.functions.invoke('wa-seguimiento', { body: { tarea: 'probar' } });
    if (error) throw error;
    const res = data as { error?: string } | null;
    if (res?.error) throw new Error(res.error);
  }

  async probarRecap(grupoJid: string, periodo: 'dia' | 'semana' = 'dia'): Promise<void> {
    const { data, error } = await this.supabase.client.functions.invoke('wa-recap', { body: { tarea: 'probar', grupo: grupoJid, periodo } });
    if (error) throw error;
    const res = data as { error?: string } | null;
    if (res?.error) throw new Error(res.error);
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

  /** DL-27/F6.5 (P3) — admin-only, auditado (sgc.audit_log). Todos los campos
   *  son requeridos a propósito: la pantalla manda el estado completo editado. */
  async guardarConfigGlobal(cfg: {
    modo_por_defecto: WaGrupoModo; max_respuestas_grupo_hora: number; budget_tokens_dia: number | null;
    recordatorio_whatsapp: boolean; recap_minimo_mensajes: number;
  }): Promise<void> {
    const { error } = await this.supabase.client.rpc('wa_config_set', {
      p_modo_por_defecto: cfg.modo_por_defecto,
      p_max_respuestas_grupo_hora: cfg.max_respuestas_grupo_hora,
      p_budget_tokens_dia: cfg.budget_tokens_dia,
      p_recordatorio_whatsapp: cfg.recordatorio_whatsapp,
      p_recap_minimo_mensajes: cfg.recap_minimo_mensajes,
    });
    if (error) throw error;
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
