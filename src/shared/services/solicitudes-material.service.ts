import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';
import {
  SolicitudMaterial,
  SolicitudMaterialFormData,
  AprobacionRequisicionResultado,
} from '../models/solicitud.model';
import { notificarSolicitud } from '../utils/notificar-solicitud.util';
import { NotificacionesService } from './notificaciones.service';

// usuarios is joined twice (solicitante_id, atendido_por) — the relationship must be
// disambiguated with !fkey_name or PostgREST rejects the embed as ambiguous.
// BC4 — the requester carries its role(s) ("Nombre · Rol"). usuarios_roles→usuarios
// is disambiguated (usuario_id vs asignado_por) to avoid an ambiguous embed.
const SELECT_QUERY =
  '*, proyecto:proyectos(nombre), ' +
  'solicitante:usuarios!solicitudes_material_solicitante_id_fkey(nombre, roles:usuarios_roles!usuarios_roles_usuario_id_fkey(rol:roles(codigo,nombre))), ' +
  'atendido:usuarios!solicitudes_material_atendido_por_fkey(nombre), ' +
  // BA6 — quién canceló/cerró (para "Cancelada: motivo · por X").
  'cerrada:usuarios!solicitudes_material_cerrada_por_fkey(nombre), items:solicitud_material_items(*)';

@Injectable({ providedIn: 'root' })
export class SolicitudesMaterialService {
  private supabase = inject(SupabaseService);
  private notificaciones = inject(NotificacionesService);

  /** RLS scopes this: engineers see their own, Inventario staff/admin see all. */
  async getAll(): Promise<SolicitudMaterial[]> {
    const { data, error } = await this.supabase.client
      .from('solicitudes_material')
      .select(SELECT_QUERY)
      .order('created_at', { ascending: false });

    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as SolicitudMaterial[];
  }

  async create(payload: SolicitudMaterialFormData): Promise<SolicitudMaterial> {
    const { data: id, error } = await this.supabase.client.rpc('crear_solicitud_material', {
      p_proyecto_id: payload.proyecto_id,
      p_solicitante_id: payload.solicitante_id,
      p_urgencia: payload.urgencia,
      p_notas: payload.notas,
      p_items: payload.items,
    });

    if (error) throw new Error(error.message);

    const { data, error: fetchError } = await this.supabase.client
      .from('solicitudes_material')
      .select(SELECT_QUERY)
      .eq('id', id as string)
      .single();

    if (fetchError) throw new Error(fetchError.message);
    notificarSolicitud(this.supabase.client, 'material', id as string, 'creada');
    this.notificaciones.refresh();
    return data as unknown as SolicitudMaterial;
  }

  /** BB10 — edita la requisición propia mientras esté pendiente (renglones/urgencia/notas). */
  async editar(
    solicitudId: string,
    payload: { urgencia?: string | null; notas?: string | null; items?: unknown[] | null },
  ): Promise<void> {
    const { error } = await this.supabase.client.rpc('editar_requisicion', {
      p_solicitud_id: solicitudId,
      p_urgencia: payload.urgencia ?? null,
      p_notas: payload.notas ?? null,
      p_items: payload.items ?? null,
    });
    if (error) throw new Error(error.message);
    this.notificaciones.refresh();
  }

  /** BB10 — historial de ediciones de una requisición (qué cambió y cuándo). */
  async ediciones(solicitudId: string): Promise<
    { editado_por: string | null; editado_por_nombre: string | null; editado_at: string; cambios: unknown }[]
  > {
    const { data, error } = await this.supabase.client.rpc('requisicion_ediciones', { p_solicitud_id: solicitudId });
    if (error) throw new Error(error.message);
    return (data ?? []) as { editado_por: string | null; editado_por_nombre: string | null; editado_at: string; cambios: unknown }[];
  }

  // P2 — se eliminó el método deprecado `aprobar()` (RPC aprobar_solicitud_material):
  // la aprobación de requisiciones es SIEMPRE `aprobarRequisicion` (auto-división), en un
  // solo hogar (la bandeja Requisiciones). El RPC legacy queda huérfano en la BD (se puede
  // dropear en una limpieza posterior; no lo llama nadie).

  /**
   * A2 — Aprobación unificada de la Requisición con auto-división:
   *   parte en stock del almacén -> DESPACHO (salida/conduce);
   *   faltante -> SOLICITUD DE COMPRA automática (bandeja de Compras).
   * Un solo paso atómico. Devuelve el resumen de la división.
   */
  async aprobarRequisicion(
    id: string,
    payload: {
      bodega_id: string;
      fecha: string;
      responsable: string | null;
      observaciones: string | null;
      items: { articulo_id: string | null; descripcion: string; unidad?: string | null; cantidad: number; talla?: string | null }[];
    },
  ): Promise<AprobacionRequisicionResultado> {
    const { data, error } = await this.supabase.client.rpc('aprobar_requisicion', {
      p_solicitud_id: id,
      p_bodega_id: payload.bodega_id,
      p_fecha: payload.fecha,
      p_responsable: payload.responsable,
      p_observaciones: payload.observaciones,
      p_items: payload.items,
    });

    if (error) throw new Error(error.message);
    notificarSolicitud(this.supabase.client, 'material', id, 'aprobada');
    this.notificaciones.refresh();
    const r = (data ?? {}) as Partial<AprobacionRequisicionResultado>;
    return {
      salida_id: r.salida_id ?? null,
      solicitud_compra_id: r.solicitud_compra_id ?? null,
      despachado_total: Number(r.despachado_total ?? 0),
      faltante_total: Number(r.faltante_total ?? 0),
    };
  }

  /**
   * U25/V14 — registra un valor "Otro" (texto libre) para la inteligencia de
   * otros_valores (sugerir crear el artículo si se repite). No bloquea el flujo.
   */
  registrarOtro(valor: string, referenciaId: string | null): void {
    const v = (valor ?? '').trim();
    if (!v) return;
    this.supabase.client
      .rpc('registrar_otro_valor', {
        p_contexto: 'requisicion_material',
        p_valor: v,
        p_referencia_id: referenciaId,
      })
      .then(({ error }) => {
        if (error) console.error('registrar_otro_valor failed', error.message);
      });
  }

  async rechazar(id: string, notas?: string | null): Promise<void> {
    const { error } = await this.supabase.client.rpc('rechazar_solicitud_material', {
      p_solicitud_id: id,
      p_notas: notas ?? null,
    });

    if (error) throw new Error(error.message);
    notificarSolicitud(this.supabase.client, 'material', id, 'rechazada');
    this.notificaciones.refresh();
  }

  // ── BA / Transporte v3 — despachos ─────────────────────────────────────────
  /** Avance por renglón (solicitado vs despachado) de una requisición. */
  async avance(id: string): Promise<RequisicionAvanceItem[]> {
    const { data, error } = await this.supabase.client.rpc('requisicion_avance', { p_solicitud_id: id });
    if (error) throw new Error(error.message);
    return (data ?? []) as RequisicionAvanceItem[];
  }

  /** Cierre manual (por rol/autor/responsable — gate server-side). */
  async cerrar(id: string): Promise<void> {
    const { error } = await this.supabase.client.rpc('requisicion_cerrar', { p_solicitud_id: id });
    if (error) throw new Error(error.message);
    this.notificaciones.refresh();
  }

  /** Cancelación con motivo obligatorio. */
  async cancelar(id: string, motivo: string): Promise<void> {
    const { error } = await this.supabase.client.rpc('requisicion_cancelar', { p_solicitud_id: id, p_motivo: motivo });
    if (error) throw new Error(error.message);
    this.notificaciones.refresh();
  }

  /** Vincular un conduce suelto (salida) a esta requisición (rectificación). */
  async vincularConduce(id: string, salidaId: string): Promise<void> {
    const { error } = await this.supabase.client.rpc('requisicion_vincular_conduce', { p_solicitud_id: id, p_salida_id: salidaId });
    if (error) throw new Error(error.message);
    this.notificaciones.refresh();
  }

  /** Conduces (salidas) sin vincular — candidatos para vincular a una requisición. */
  async conducesSinVincular(proyectoId?: string | null): Promise<ConduceSuelto[]> {
    const { data, error } = await this.supabase.client.rpc('conduces_sin_vincular', { p_proyecto_id: proyectoId ?? null });
    if (error) throw new Error(error.message);
    return (data ?? []) as ConduceSuelto[];
  }
}

/** BA — un conduce (salida) sin vincular a ninguna requisición. */
export interface ConduceSuelto {
  id: string;
  fecha: string;
  motivo: string | null;
  proyecto_id: string | null;
  estado: string | null;
  despachante_nombre: string | null;
  creado_en: string;
}

/** BA — un renglón del avance de despacho de una requisición. */
export interface RequisicionAvanceItem {
  articulo_id: string | null;
  descripcion: string;
  unidad: string | null;
  talla: string | null;
  solicitado: number;
  despachado: number;
  pendiente: number;
}
