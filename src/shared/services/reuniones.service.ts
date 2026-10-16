import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';

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
}

export interface ReunionParticipanteDetalle {
  id: string;
  usuario_id: string | null;
  nombre: string;
  correo_externo: string | null;
  asistio: boolean | null;
}
export interface ReunionAgendaItem { id: string; orden: number; texto: string }
export interface ReunionNota { id: string; usuario_id: string; usuario_nombre: string; texto: string; es_mia: boolean }
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
  }): Promise<string> {
    const { data, error } = await this.supabase.client.rpc('reunion_crear', {
      p_tipo_id: p.tipoId, p_titulo: p.titulo, p_inicio: p.inicio, p_fin: p.fin,
      p_modalidad: p.modalidad, p_lugar: p.lugar ?? null,
      p_proyecto_id: p.proyectoId ?? null, p_expediente_id: p.expedienteId ?? null, p_solicitud_compra_id: p.solicitudCompraId ?? null,
      p_participantes_usuarios: p.participantesUsuarios, p_participantes_externos: p.participantesExternos,
      p_agenda: p.agenda ?? null,
    });
    if (error) throw new Error(error.message);
    const id = data as string;
    // CP8 — crea el evento de Google Calendar (con Meet) si el módulo está
    // conectado; si no, el edge responde {conectado:false} y no rompe nada.
    // Fire-and-forget: la reunión ya existe en el SGC aunque Calendar falle.
    void this.sincronizarCalendar(id).catch(() => {});
    return id;
  }

  /** CP8 — crea/actualiza el evento de Calendar de una reunión. {conectado:false} si no hay llaves.
   *  Privado: hoy solo se llama desde `crear()` (fire-and-forget). Si se agrega
   *  un botón "Reintentar sincronizar con Calendar" en la ficha, se vuelve público. */
  private async sincronizarCalendar(reunionId: string, accion: 'crear' | 'actualizar' | 'cancelar' = 'crear'): Promise<{ conectado: boolean; mensaje?: string; enlace?: string }> {
    const { data, error } = await this.supabase.client.functions.invoke('reuniones-calendar', { body: { accion, reunion_id: reunionId } });
    if (error) return { conectado: false, mensaje: 'No se pudo conectar con Calendar.' };
    return data as { conectado: boolean; mensaje?: string; enlace?: string };
  }

  async guardarNota(reunionId: string, texto: string): Promise<void> {
    const { error } = await this.supabase.client.rpc('reunion_nota_guardar', { p_reunion_id: reunionId, p_texto: texto });
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
