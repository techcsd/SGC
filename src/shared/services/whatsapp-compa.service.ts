import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';
import { environment } from '../../environments/environment';

/**
 * DC7 — "Compa en WhatsApp" (Tecnología): gestión del canal WhatsApp Cloud API
 * construido en la ronda DC (edge `whatsapp-webhook` + tablas `whatsapp_autorizados`
 * / `whatsapp_mensajes` / `whatsapp_conversaciones`, ver sql/2026-10-29-dc2-…,
 * sql/2026-09-04-bj2-…, docs/WHATSAPP-COMPA.md). Esta pantalla es SOLO web — no
 * hay equivalente en csd-app (ver PARIDAD.md, Ronda DC).
 */

export type WhatsappMensajeTipo = 'texto' | 'audio' | 'imagen' | 'documento' | 'otro' | 'estado';
export type WhatsappMensajeEstado =
  | 'recibido' | 'procesando' | 'respondido' | 'no_autorizado' | 'ignorado'
  | 'error' | 'entregado' | 'leido' | 'fallido';

export interface WhatsappAutorizado {
  telefono: string;
  usuario_id: string;
  activo: boolean;
  nota: string | null;
  creado_por: string | null;
  creado_en: string;
  actualizado_en: string | null;
  ultimo_uso_en: string | null;
  usuario_nombre: string;
  usuario_email: string | null;
  usuario_telefono: string | null;
  usuario_activo: boolean;
}

interface AutorizadoRow {
  telefono: string;
  usuario_id: string;
  activo: boolean;
  nota: string | null;
  creado_por: string | null;
  creado_en: string;
  actualizado_en: string | null;
  ultimo_uso_en: string | null;
  usuario: { nombre: string; email: string | null; telefono: string | null; activo: boolean | null } | null;
}

export interface WhatsappMensaje {
  id: string;
  wa_message_id: string | null;
  direccion: 'entrada' | 'salida';
  telefono: string;
  usuario_id: string | null;
  usuario_nombre: string | null;
  tipo: WhatsappMensajeTipo;
  texto: string | null;
  estado: WhatsappMensajeEstado;
  error: string | null;
  duracion_ms: number | null;
  conversacion_id: string | null;
  creado_en: string;
}

interface MensajeRow {
  id: string;
  wa_message_id: string | null;
  direccion: 'entrada' | 'salida';
  telefono: string;
  usuario_id: string | null;
  tipo: WhatsappMensajeTipo;
  texto: string | null;
  estado: WhatsappMensajeEstado;
  error: string | null;
  duracion_ms: number | null;
  conversacion_id: string | null;
  creado_en: string;
  usuario: { nombre: string } | null;
}

export interface WhatsappMensajesFiltro {
  estado?: string | null;
  desde?: string | null; // YYYY-MM-DD
  hasta?: string | null; // YYYY-MM-DD
  limite?: number;
}

export interface WhatsappEstadoEdge {
  secretos: Record<string, boolean>;
  graph_version: string;
}

export interface WhatsappEstadoResumen {
  ultimoEntradaEn: string | null;
  ultimoErrorEn: string | null;
  ultimoErrorTelefono: string | null;
  count24h: number;
  count7d: number;
}

/** Normaliza un teléfono a solo dígitos y quita el código de país '1' cuando el
 *  resultado trae 11 dígitos (p. ej. '+1 (829) 966-3040' → '8299663040'). Mismo
 *  criterio de comparación que usa el servidor (últimos 10 dígitos). */
export function normalizarTelefonoWhatsapp(valor: string): string {
  const digitos = (valor ?? '').replace(/\D/g, '');
  return digitos.length === 11 && digitos.startsWith('1') ? digitos.slice(1) : digitos;
}

@Injectable({ providedIn: 'root' })
export class WhatsappCompaService {
  private supabase = inject(SupabaseService);

  private mapAutorizado(r: AutorizadoRow): WhatsappAutorizado {
    return {
      telefono: r.telefono,
      usuario_id: r.usuario_id,
      activo: r.activo,
      nota: r.nota,
      creado_por: r.creado_por,
      creado_en: r.creado_en,
      actualizado_en: r.actualizado_en,
      ultimo_uso_en: r.ultimo_uso_en,
      usuario_nombre: r.usuario?.nombre ?? '(usuario eliminado)',
      usuario_email: r.usuario?.email ?? null,
      usuario_telefono: r.usuario?.telefono ?? null,
      usuario_activo: r.usuario?.activo ?? true,
    };
  }

  private mapMensaje(r: MensajeRow): WhatsappMensaje {
    return {
      id: r.id,
      wa_message_id: r.wa_message_id,
      direccion: r.direccion,
      telefono: r.telefono,
      usuario_id: r.usuario_id,
      usuario_nombre: r.usuario?.nombre ?? null,
      tipo: r.tipo,
      texto: r.texto,
      estado: r.estado,
      error: r.error,
      duracion_ms: r.duracion_ms,
      conversacion_id: r.conversacion_id,
      creado_en: r.creado_en,
    };
  }

  async listarAutorizados(): Promise<WhatsappAutorizado[]> {
    const { data, error } = await this.supabase.client
      .from('whatsapp_autorizados')
      .select('*, usuario:usuarios!usuario_id(nombre,email,telefono,activo)')
      .order('creado_en', { ascending: false });
    if (error) throw error;
    return ((data ?? []) as AutorizadoRow[]).map((r) => this.mapAutorizado(r));
  }

  /** Teléfono en la ficha del usuario, para prellenar (editable) al autorizar. */
  async telefonoDeUsuario(usuarioId: string): Promise<string | null> {
    const { data, error } = await this.supabase.client
      .from('usuarios')
      .select('telefono')
      .eq('id', usuarioId)
      .maybeSingle();
    if (error) throw error;
    return (data as { telefono: string | null } | null)?.telefono ?? null;
  }

  async crearAutorizado(usuarioId: string, telefono: string, nota: string | null, creadoPor: string | null): Promise<void> {
    const tel = normalizarTelefonoWhatsapp(telefono);
    const { error } = await this.supabase.client
      .from('whatsapp_autorizados')
      .insert({ telefono: tel, usuario_id: usuarioId, nota, creado_por: creadoPor });
    if (error) throw error;
  }

  async actualizarAutorizado(telefono: string, patch: { activo?: boolean; nota?: string | null }): Promise<void> {
    const { error } = await this.supabase.client
      .from('whatsapp_autorizados')
      .update({ ...patch, actualizado_en: new Date().toISOString() })
      .eq('telefono', telefono);
    if (error) throw error;
  }

  async eliminarAutorizado(telefono: string): Promise<void> {
    const { error } = await this.supabase.client.from('whatsapp_autorizados').delete().eq('telefono', telefono);
    if (error) throw error;
  }

  async listarMensajes(filtro: WhatsappMensajesFiltro): Promise<WhatsappMensaje[]> {
    let q = this.supabase.client
      .from('whatsapp_mensajes')
      .select('*, usuario:usuarios!usuario_id(nombre)')
      .order('creado_en', { ascending: false })
      .limit(filtro.limite ?? 300);
    if (filtro.estado) q = q.eq('estado', filtro.estado);
    if (filtro.desde) q = q.gte('creado_en', `${filtro.desde}T00:00:00`);
    if (filtro.hasta) q = q.lte('creado_en', `${filtro.hasta}T23:59:59`);
    const { data, error } = await q;
    if (error) throw error;
    return ((data ?? []) as MensajeRow[]).map((r) => this.mapMensaje(r));
  }

  /** Mensajes de la misma conversación: por `conversacion_id` si lo trae; si no,
   *  por proximidad (mismo teléfono, ±10 min alrededor del mensaje elegido). */
  async conversacionDe(m: WhatsappMensaje): Promise<WhatsappMensaje[]> {
    const base = this.supabase.client
      .from('whatsapp_mensajes')
      .select('*, usuario:usuarios!usuario_id(nombre)')
      .order('creado_en', { ascending: true });
    if (m.conversacion_id) {
      const { data, error } = await base.eq('conversacion_id', m.conversacion_id);
      if (error) throw error;
      return ((data ?? []) as MensajeRow[]).map((r) => this.mapMensaje(r));
    }
    const centro = new Date(m.creado_en).getTime();
    const desde = new Date(centro - 10 * 60 * 1000).toISOString();
    const hasta = new Date(centro + 10 * 60 * 1000).toISOString();
    const { data, error } = await base.eq('telefono', m.telefono).gte('creado_en', desde).lte('creado_en', hasta);
    if (error) throw error;
    return ((data ?? []) as MensajeRow[]).map((r) => this.mapMensaje(r));
  }

  async resumenEstado(): Promise<WhatsappEstadoResumen> {
    const desde24h = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const desde7d = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
    const [ultimoEntrada, ultimoError, c24, c7] = await Promise.all([
      this.supabase.client.from('whatsapp_mensajes').select('creado_en').eq('direccion', 'entrada')
        .order('creado_en', { ascending: false }).limit(1).maybeSingle(),
      this.supabase.client.from('whatsapp_mensajes').select('creado_en, telefono').in('estado', ['error', 'fallido'])
        .order('creado_en', { ascending: false }).limit(1).maybeSingle(),
      this.supabase.client.from('whatsapp_mensajes').select('id', { count: 'exact', head: true }).gte('creado_en', desde24h),
      this.supabase.client.from('whatsapp_mensajes').select('id', { count: 'exact', head: true }).gte('creado_en', desde7d),
    ]);
    if (ultimoEntrada.error) throw ultimoEntrada.error;
    if (ultimoError.error) throw ultimoError.error;
    if (c24.error) throw c24.error;
    if (c7.error) throw c7.error;
    const ue = ultimoEntrada.data as { creado_en: string } | null;
    const uerr = ultimoError.data as { creado_en: string; telefono: string } | null;
    return {
      ultimoEntradaEn: ue?.creado_en ?? null,
      ultimoErrorEn: uerr?.creado_en ?? null,
      ultimoErrorTelefono: uerr?.telefono ?? null,
      count24h: c24.count ?? 0,
      count7d: c7.count ?? 0,
    };
  }

  /**
   * DC7 — estado de los secretos del edge (`GET ?modo=estado`). Se usa `fetch`
   * directo (no el `invokeEdge` compartido): ese helper está pensado para invocar
   * con POST + body y reintento de transporte; este endpoint es un GET con
   * querystring que solo necesita el access_token de la sesión tal cual.
   */
  async estadoEdge(): Promise<WhatsappEstadoEdge> {
    const { data: sess } = await this.supabase.client.auth.getSession();
    const token = sess.session?.access_token;
    if (!token) throw new Error('Tu sesión expiró. Vuelve a iniciar sesión.');
    const res = await fetch(`${environment.supabaseUrl}/functions/v1/whatsapp-webhook?modo=estado`, {
      headers: { Authorization: `Bearer ${token}`, apikey: environment.supabaseAnonKey },
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error || `Error ${res.status} consultando el estado del canal.`);
    }
    return (await res.json()) as WhatsappEstadoEdge;
  }

  /** URL del webhook para este entorno, a pegar en el dashboard de Meta. */
  webhookUrl(): string {
    return `${environment.supabaseUrl}/functions/v1/whatsapp-webhook`;
  }
}
