import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';
import { invokeEdge } from '../utils/edge.util';

/** CP8 — tipo de reunión configurable (con agenda por defecto). */
export interface ReunionTipo {
  id: string;
  codigo: string;
  nombre: string;
  color: string;
  agenda_default: string[];
  activo: boolean;
  orden: number;
}

export type ReunionModalidad = 'presencial' | 'meet' | 'mixta';
export type ReunionEstado = 'programada' | 'en_curso' | 'acta_borrador' | 'acta_aprobada' | 'cancelada';
export type ReunionFiltro = 'proximas' | 'acta_pendiente' | 'pasadas' | 'mias';
/** CT1 — estado real de la sincronización con Google Calendar (lo escribe la edge en cada intento). */
export type CalendarSyncEstado = 'no_conectado' | 'sincronizado' | 'error' | 'pendiente';

/** CS10 — un evento del calendario de Google propio (solo lectura). */
export interface EventoGoogle {
  id: string;
  titulo: string;
  inicio: string | null;
  fin: string | null;
  lugar: string | null;
  enlace_meet: string | null;
  organizador: string | null;
  participantes: number | null;
  privado: boolean;
}
export interface MiCalendarioGoogle {
  conectado: boolean;
  motivo?: 'no_configurado' | 'sin_cuenta_google' | 'error_google';
  mensaje?: string;
  eventos?: EventoGoogle[];
  actualizado_en?: string;
}

export interface ReunionListado {
  id: string;
  tipo_codigo: string;
  tipo_nombre: string;
  tipo_color: string;
  titulo: string;
  inicio: string;
  fin: string;
  modalidad: ReunionModalidad;
  lugar: string | null;
  enlace: string | null;
  proyecto_id: string | null;
  proyecto_nombre: string | null;
  organizador_id: string;
  organizador_nombre: string;
  estado: ReunionEstado;
  fireflies_id: string | null;
  participantes_n: number;
  acuerdos_n: number;
  acta_lista: boolean;
  /** CS10 — para cruzar con «Mi calendario de Google» (EN EL SGC / SOLO EN GOOGLE). */
  google_event_id: string | null;
  calendar_sync_estado: CalendarSyncEstado;
}

export interface ReunionParticipanteDetalle {
  id: string;
  usuario_id: string | null;
  nombre: string;
  correo_externo: string | null;
  asistio: boolean | null;
}
export interface ReunionAgendaItem { id: string; orden: number; texto: string }
export interface ReunionNota { id: string; usuario_id: string; usuario_nombre: string; texto: string; foto_path: string | null; es_mia: boolean }
export interface ReunionAcuerdo {
  id: string; texto: string; responsable_id: string | null; responsable_nombre: string | null;
  fecha: string | null; tarea_id: string | null;
}
export interface ReunionActa {
  id: string; resumen: string | null; transcripcion_url: string | null;
  version: number; aprobada_por: string | null; aprobada_at: string | null; enviada_at: string | null;
}
export interface ReunionRow {
  id: string; tipo_id: string; titulo: string; inicio: string; fin: string;
  modalidad: ReunionModalidad; lugar: string | null; enlace: string | null;
  proyecto_id: string | null; organizador_id: string; estado: ReunionEstado;
  fireflies_id: string | null; tipo_codigo: string; tipo_nombre: string; tipo_color: string;
  proyecto_nombre: string | null; organizador_nombre: string;
  calendar_sync_estado: CalendarSyncEstado; calendar_sync_error: string | null; calendar_sync_at: string | null;
}
export interface ReunionDetalle {
  reunion: ReunionRow;
  participantes: ReunionParticipanteDetalle[];
  agenda: ReunionAgendaItem[];
  notas: ReunionNota[];
  acuerdos: ReunionAcuerdo[];
  acta: ReunionActa | null;
}

export interface ParticipanteExterno { correo: string; nombre: string }

/**
 * CP8 — cliente del módulo Reuniones. Toda la lógica de permisos vive en RLS +
 * las RPCs `security definer` (ver `sql/2026-10-16-cp8-reuniones.sql`); este
 * servicio solo invoca y tipa las respuestas.
 */
@Injectable({ providedIn: 'root' })
export class ReunionesService {
  private supabase = inject(SupabaseService);

  async tipos(): Promise<ReunionTipo[]> {
    const { data, error } = await this.supabase.client
      .from('reunion_tipos')
      .select('id, codigo, nombre, color, agenda_default, activo, orden')
      .eq('activo', true)
      .order('orden');
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as ReunionTipo[];
  }

  async listado(filtro: ReunionFiltro = 'proximas', tipoId: string | null = null, proyectoId: string | null = null): Promise<ReunionListado[]> {
    const { data, error } = await this.supabase.client.rpc('reuniones_listado', {
      p_filtro: filtro, p_tipo_id: tipoId, p_proyecto_id: proyectoId,
    });
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as ReunionListado[];
  }

  async detalle(id: string): Promise<ReunionDetalle> {
    const { data, error } = await this.supabase.client.rpc('reunion_detalle', { p_id: id });
    if (error) throw new Error(error.message);
    return data as unknown as ReunionDetalle;
  }

  async crear(p: {
    tipoId: string; titulo: string; inicio: string; fin: string;
    modalidad: ReunionModalidad; lugar?: string | null;
    proyectoId?: string | null; expedienteId?: string | null; solicitudCompraId?: string | null;
    participantesUsuarios: string[]; participantesExternos: ParticipanteExterno[];
    agenda?: string[] | null;
  }): Promise<{ id: string; calendar: { conectado: boolean; mensaje?: string; enlace?: string; motivo?: 'no_configurado' } }> {
    const { data, error } = await this.supabase.client.rpc('reunion_crear', {
      p_tipo_id: p.tipoId, p_titulo: p.titulo, p_inicio: p.inicio, p_fin: p.fin,
      p_modalidad: p.modalidad, p_lugar: p.lugar ?? null,
      p_proyecto_id: p.proyectoId ?? null, p_expediente_id: p.expedienteId ?? null, p_solicitud_compra_id: p.solicitudCompraId ?? null,
      p_participantes_usuarios: p.participantesUsuarios, p_participantes_externos: p.participantesExternos,
      p_agenda: p.agenda ?? null,
    });
    if (error) throw new Error(error.message);
    const id = data as string;
    // CP8/CT1 — crea el evento de Google Calendar (con Meet) si el módulo está
    // conectado; la reunión ya existe en el SGC aunque Calendar falle, pero el
    // resultado real ya no se descarta (antes: fire-and-forget con .catch(()=>{})).
    const calendar = await this.reintentarSincronizacion(id, 'crear');
    return { id, calendar };
  }

  // ── CS10 — "Mi calendario de Google" (lectura) ──────────────────────────────
  /** Trae los eventos del calendario de Google del usuario (solo lectura, solo
   *  el suyo). `conectado:false` con `motivo` cuando no hay nada que mostrar. */
  async miCalendarioGoogle(): Promise<MiCalendarioGoogle> {
    const { data, error } = await this.supabase.client.functions.invoke('reuniones-mi-calendario', { body: {} });
    if (error) return { conectado: false, motivo: 'error_google', mensaje: 'No se pudo actualizar tu calendario de Google.' };
    return data as MiCalendarioGoogle;
  }

  /** CS10 — convierte un evento "solo en Google" en una reunión del SGC
   *  (idempotente: el índice único de `google_event_id` evita duplicar si se
   *  pulsa dos veces). Usa el tipo "Otra" por defecto. */
  async llevarAlSgc(evento: EventoGoogle): Promise<string> {
    // Idempotencia por adelantado (evita crear un huérfano si el índice único
    // rechaza luego): si ya existe una reunión con este google_event_id, úsala.
    const { data: existente } = await this.supabase.client.from('reuniones').select('id').eq('google_event_id', evento.id).maybeSingle();
    if (existente) return existente.id as string;

    const tipos = await this.tipos();
    const tipoOtra = tipos.find((t) => t.codigo === 'otra' || t.nombre.toLowerCase() === 'otra') ?? tipos[0];
    if (!tipoOtra) throw new Error('No hay tipos de reunión configurados.');
    if (!evento.inicio) throw new Error('El evento no tiene hora de inicio.');
    const id = await this.crearSinSincronizar({
      tipoId: tipoOtra.id, titulo: evento.titulo, inicio: evento.inicio, fin: evento.fin ?? evento.inicio,
      modalidad: evento.enlace_meet ? 'meet' : 'presencial', lugar: evento.lugar ?? null,
      participantesUsuarios: [], participantesExternos: [],
    });
    const { error } = await this.supabase.client.from('reuniones').update({ google_event_id: evento.id, enlace: evento.enlace_meet }).eq('id', id);
    if (error) {
      // CS10 — idempotente: dos clics no duplican (índice único de google_event_id).
      if (error.code === '23505') throw new Error('Esta reunión ya estaba en el SGC.');
      throw new Error(error.message);
    }
    return id;
  }

  /** Igual que `crear()` pero SIN disparar la sincronización con Calendar (CS10:
   *  "Llevar al SGC" nunca debe escribir de vuelta en Google — ya existe allá). */
  private async crearSinSincronizar(p: {
    tipoId: string; titulo: string; inicio: string; fin: string;
    modalidad: ReunionModalidad; lugar?: string | null;
    participantesUsuarios: string[]; participantesExternos: ParticipanteExterno[];
  }): Promise<string> {
    const { data, error } = await this.supabase.client.rpc('reunion_crear', {
      p_tipo_id: p.tipoId, p_titulo: p.titulo, p_inicio: p.inicio, p_fin: p.fin,
      p_modalidad: p.modalidad, p_lugar: p.lugar ?? null,
      p_proyecto_id: null, p_expediente_id: null, p_solicitud_compra_id: null,
      p_participantes_usuarios: p.participantesUsuarios, p_participantes_externos: p.participantesExternos,
      p_agenda: null,
    });
    if (error) throw new Error(error.message);
    return data as string;
  }

  /** CT1 — crea/actualiza/cancela el evento de Calendar de una reunión y escribe
   *  `calendar_sync_estado/error/at` en el lado del servidor. Pública: la usan
   *  `crear()`, `cancelar()` y el botón "Reintentar" de la ficha. */
  async reintentarSincronizacion(reunionId: string, accion: 'crear' | 'actualizar' | 'cancelar' = 'crear'): Promise<{ conectado: boolean; mensaje?: string; enlace?: string; motivo?: 'no_configurado' }> {
    try {
      return await invokeEdge<{ conectado: boolean; mensaje?: string; enlace?: string; motivo?: 'no_configurado' }>(
        this.supabase.client, 'reuniones-calendar', { accion, reunion_id: reunionId },
      );
    } catch (e) {
      return { conectado: false, mensaje: e instanceof Error ? e.message : 'No se pudo conectar con Calendar.' };
    }
  }

  /** CT1 — cancela la reunión en el SGC y dispara la cancelación del evento de Calendar. */
  async cancelar(reunionId: string): Promise<{ conectado: boolean; mensaje?: string; motivo?: 'no_configurado' }> {
    const { error } = await this.supabase.client.rpc('reunion_cancelar', { p_id: reunionId });
    if (error) throw new Error(error.message);
    return this.reintentarSincronizacion(reunionId, 'cancelar');
  }

  /** CP8c — la nota puede llevar una "foto de pizarra" (bucket privado `reuniones`). */
  async guardarNota(reunionId: string, texto: string, foto?: File | null): Promise<void> {
    let fotoPath: string | null = null;
    if (foto) {
      fotoPath = `${reunionId}/${crypto.randomUUID()}-${foto.name}`;
      const { error: upErr } = await this.supabase.client.storage.from('reuniones').upload(fotoPath, foto, { upsert: true });
      if (upErr) throw new Error(upErr.message);
    }
    const { error } = await this.supabase.client.rpc('reunion_nota_guardar', { p_reunion_id: reunionId, p_texto: texto, p_foto_path: fotoPath });
    if (error) throw new Error(error.message);
  }

  async crearAcuerdo(reunionId: string, texto: string, responsableId: string | null, fecha: string | null): Promise<string> {
    const { data, error } = await this.supabase.client.rpc('reunion_acuerdo_crear', {
      p_reunion_id: reunionId, p_texto: texto, p_responsable_id: responsableId, p_fecha: fecha,
    });
    if (error) throw new Error(error.message);
    return data as string;
  }

  async crearTareasDeAcuerdos(reunionId: string): Promise<number> {
    const { data, error } = await this.supabase.client.rpc('reunion_acuerdos_crear_tareas', { p_reunion_id: reunionId });
    if (error) throw new Error(error.message);
    return data as number;
  }

  async guardarActa(reunionId: string, resumen: string): Promise<void> {
    const { error } = await this.supabase.client.rpc('reunion_acta_guardar', { p_reunion_id: reunionId, p_resumen: resumen });
    if (error) throw new Error(error.message);
  }

  /** Aprueba el acta (crea tareas pendientes) y la marca enviada — ver nota de
   *  degradación: no hay edge de correo real todavía (docs/REUNIONES.md). */
  async aprobarActa(reunionId: string): Promise<number> {
    const { data, error } = await this.supabase.client.rpc('reunion_acta_aprobar', { p_reunion_id: reunionId });
    if (error) throw new Error(error.message);
    await this.supabase.client.rpc('reunion_acta_marcar_enviada', { p_reunion_id: reunionId });
    return data as number;
  }
}
