import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';
import { SignedUrlCache, ImgTransform } from './signed-url-cache.service';
import { Vehiculo, VehiculoFormData } from '../models/vehiculo.model';
import { VehiculoAsignacion, VehiculoStats } from '../models/vehiculo-asignacion.model';

/** W3 — recepción abierta de un vehículo (pre-check `entrega_abierta_de`). */
export interface EntregaAbierta {
  entrega_id: string;
  conductor_usuario_id: string;
  conductor: string;
  desde: string;
  km: number;
  es_mia: boolean;
}

/**
 * W3 — el servidor rechazó la recepción porque el vehículo tiene una recepción
 * abierta de OTRO conductor. Trae la info estructurada para ofrecer el handover.
 */
export class HandoverRequeridoError extends Error {
  constructor(
    message: string,
    readonly info: EntregaAbierta | null,
  ) {
    super(message);
    this.name = 'HandoverRequeridoError';
  }
}

/** AC8 — vehículo actualmente retenido (custodia abierta) o asignado por roster. */
export interface VehiculoAsignado {
  vehiculo_id: string;
  usuario_id: string;
  nombre: string;
  motivo: 'custodia' | 'asignacion';
}

/** A vehicle custody handoff captured from the CSD field app. */
export interface VehiculoEntrega {
  id: string;
  vehiculo_id: string;
  tipo: 'recepcion' | 'devolucion';
  estado: 'abierta' | 'cerrada';
  km: number;
  combustible: string;
  tiene_danos: boolean;
  requiere_revision: boolean;
  observacion: string | null;
  firma_url: string | null;
  gps_lat: number | null;
  gps_lng: number | null;
  capturado_en: string;
  created_at: string;
  vehiculo?: { placa: string; marca: string; modelo: string } | null;
  conductor?: { nombre: string } | null;
  fotos?: { id: string; slot: string; storage_path: string }[];
  danos?: { id: string; zona: string; descripcion: string | null; foto_path: string; es_nuevo: boolean }[];
}

// TODO: Run this SQL in Supabase to create the flota tables:
//
// create table sgc.vehiculos (
//   id uuid primary key default gen_random_uuid(),
//   placa text not null unique,
//   marca text not null,
//   modelo text not null,
//   anio int not null,
//   tipo text not null,
//   estado text not null default 'activo',
//   color text,
//   kilometraje int not null default 0,
//   capacidad_carga text,
//   responsable_id uuid references sgc.usuarios(id),
//   notas text,
//   activo boolean not null default true,
//   created_at timestamptz default now(),
//   updated_at timestamptz default now()
// );
// alter table sgc.vehiculos enable row level security;
// create policy "vehiculos: read" on sgc.vehiculos for select to authenticated using (true);
// create policy "vehiculos: write" on sgc.vehiculos for all to authenticated using (sgc.is_admin()) with check (sgc.is_admin());
// grant select, insert, update, delete on sgc.vehiculos to authenticated;

@Injectable({ providedIn: 'root' })
export class VehiculosService {
  private supabase = inject(SupabaseService);
  private cache = inject(SignedUrlCache);

  async getAll(): Promise<Vehiculo[]> {
    const { data, error } = await this.supabase.client
      .from('vehiculos')
      .select('*, responsable:usuarios(nombre)')
      .order('placa');

    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as Vehiculo[];
  }

  /** Un vehículo con su responsable (perfil, R4). */
  async getById(id: string): Promise<Vehiculo | null> {
    const { data, error } = await this.supabase.client
      .from('vehiculos')
      .select('*, responsable:usuarios(nombre)')
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (data as unknown as Vehiculo) ?? null;
  }

  // ── Stats agregados (vista sgc.v_vehiculo_stats, R4) ──────────────────────
  async getStats(vehiculoId: string): Promise<VehiculoStats | null> {
    const { data, error } = await this.supabase.client
      .from('v_vehiculo_stats')
      .select('*')
      .eq('vehiculo_id', vehiculoId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (data as unknown as VehiculoStats) ?? null;
  }

  async getStatsAll(): Promise<VehiculoStats[]> {
    const { data, error } = await this.supabase.client
      .from('v_vehiculo_stats')
      .select('*');
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as VehiculoStats[];
  }

  // ── Asignaciones (multi-asignación, R1) ───────────────────────────────────
  private readonly ASIG_SELECT =
    '*, usuario:usuarios(nombre), conductor:conductores(nombre), vehiculo:vehiculos(placa, marca, modelo)';

  /** Asignaciones (activas e históricas) de un vehículo. */
  async getAsignaciones(vehiculoId: string): Promise<VehiculoAsignacion[]> {
    const { data, error } = await this.supabase.client
      .from('vehiculo_asignaciones')
      .select(this.ASIG_SELECT)
      .eq('vehiculo_id', vehiculoId)
      .order('activa', { ascending: false })
      .order('desde', { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as VehiculoAsignacion[];
  }

  /** Asignaciones activas de un usuario dado (fuente de verdad única del vínculo, U2). */
  async getAsignacionesActivasByUsuario(usuarioId: string): Promise<VehiculoAsignacion[]> {
    const { data, error } = await this.supabase.client
      .from('vehiculo_asignaciones')
      .select(this.ASIG_SELECT)
      .eq('usuario_id', usuarioId)
      .eq('activa', true)
      .order('desde', { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as VehiculoAsignacion[];
  }

  /** Mis vehículos asignados (asignaciones activas del usuario actual). */
  async getMisAsignaciones(): Promise<VehiculoAsignacion[]> {
    const { data: auth } = await this.supabase.client.auth.getUser();
    const uid = auth?.user?.id;
    if (!uid) return [];
    const { data, error } = await this.supabase.client
      .from('vehiculo_asignaciones')
      .select(this.ASIG_SELECT)
      .eq('usuario_id', uid)
      .eq('activa', true)
      .order('desde', { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as VehiculoAsignacion[];
  }

  /** Auto-asignarme un vehículo (RPC SECURITY DEFINER, idempotente). */
  async asignarme(vehiculoId: string): Promise<Record<string, unknown>> {
    const { data, error } = await this.supabase.client.rpc('asignarme_vehiculo', {
      p_vehiculo_id: vehiculoId,
      p_client_uuid: crypto.randomUUID(),
    });
    if (error) throw new Error(error.message);
    return (data ?? {}) as Record<string, unknown>;
  }

  /**
   * AC8 — vehículos actualmente retenidos (custodia abierta) o asignados por
   * roster, indexados por `vehiculo_id`. Se usa para deshabilitar/anotar en los
   * selectores los vehículos que ya tiene otra persona.
   */
  async getVehiculosAsignados(): Promise<Map<string, VehiculoAsignado>> {
    const { data, error } = await this.supabase.client.rpc('vehiculos_asignados');
    if (error) throw new Error(error.message);
    const map = new Map<string, VehiculoAsignado>();
    for (const row of (data ?? []) as VehiculoAsignado[]) {
      map.set(row.vehiculo_id, row);
    }
    return map;
  }

  /** Asigna un vehículo a una persona (gestión flota/admin). */
  async crearAsignacion(payload: {
    vehiculo_id: string;
    usuario_id?: string | null;
    conductor_id?: string | null;
    notas?: string | null;
  }): Promise<void> {
    const { error } = await this.supabase.client
      .from('vehiculo_asignaciones')
      .insert({ ...payload, origen: 'admin', activa: true });
    if (error) throw new Error(error.message);
  }

  /** Retira (desactiva) una asignación. */
  async retirarAsignacion(id: string): Promise<void> {
    const { error } = await this.supabase.client
      .from('vehiculo_asignaciones')
      .update({ activa: false, hasta: new Date().toISOString() })
      .eq('id', id);
    if (error) throw new Error(error.message);
  }

  /** Reactiva un vehículo bloqueado (RPC flota/admin). */
  async reactivar(id: string, nota?: string): Promise<void> {
    const { error } = await this.supabase.client.rpc('reactivar_vehiculo', {
      p_id: id,
      p_nota: nota ?? null,
    });
    if (error) throw new Error(error.message);
  }

  async create(payload: VehiculoFormData): Promise<Vehiculo> {
    const { data, error } = await this.supabase.client
      .from('vehiculos')
      .insert(payload)
      .select('*, responsable:usuarios(nombre)')
      .single();

    if (error) throw new Error(error.message);
    return data as unknown as Vehiculo;
  }

  async update(id: string, payload: Partial<VehiculoFormData>): Promise<Vehiculo> {
    const { data, error } = await this.supabase.client
      .from('vehiculos')
      .update(payload)
      .eq('id', id)
      .select('*, responsable:usuarios(nombre)')
      .single();

    if (error) throw new Error(error.message);
    return data as unknown as Vehiculo;
  }

  /** T2 — elimina una fila de datos de prueba (RPC SECURITY DEFINER, solo admin;
   *  solo borra si `es_prueba = true`). Lanza en error. */
  async eliminarDatoPrueba(id: string): Promise<boolean> {
    const { data, error } = await this.supabase.client.rpc('eliminar_dato_prueba', {
      p_tabla: 'vehiculos',
      p_id: id,
    });
    if (error) throw new Error(error.message);
    return data === true;
  }

  async toggleActivo(id: string, activo: boolean): Promise<void> {
    const { error } = await this.supabase.client
      .from('vehiculos')
      .update({ activo })
      .eq('id', id);

    if (error) throw new Error(error.message);
  }

  /**
   * Vehicle responsibility history captured by the CSD field app
   * (`vehiculo_entregas`). RLS scopes visibility: flota staff see everything.
   * usuarios is joined twice (conductor / creado_por) so the embed must name
   * the FK to stay unambiguous.
   */
  async getResponsabilidad(): Promise<VehiculoEntrega[]> {
    const { data, error } = await this.supabase.client
      .from('vehiculo_entregas')
      .select(
        '*, vehiculo:vehiculos(placa, marca, modelo),' +
          ' conductor:usuarios!vehiculo_entregas_conductor_usuario_id_fkey(nombre),' +
          ' fotos:vehiculo_entrega_fotos(id, slot, storage_path),' +
          ' danos:vehiculo_entrega_danos(id, zona, descripcion, foto_path, es_nuevo)',
      )
      .order('created_at', { ascending: false });

    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as VehiculoEntrega[];
  }

  /** Id de cliente para enlazar fotos/firma antes de crear la entrega. */
  nuevaEntregaId(): string {
    return crypto.randomUUID();
  }

  /** Sube una foto de la entrega (slot obligatorio o de daño) al bucket `vehiculos`. */
  async uploadEntregaFoto(entregaId: string, slot: string, file: File): Promise<{ slot: string; path: string }> {
    const path = `entrega/${entregaId}/${slot}-${crypto.randomUUID()}.jpg`;
    const { error } = await this.supabase.client.storage.from('vehiculos').upload(path, file);
    if (error) throw new Error(error.message);
    return { slot, path };
  }

  /** Sube la firma (PNG) de la entrega al bucket `vehiculos`. */
  async uploadEntregaFirma(entregaId: string, blob: Blob): Promise<string> {
    const path = `entrega/${entregaId}/firma-${crypto.randomUUID()}.png`;
    const { error } = await this.supabase.client.storage.from('vehiculos').upload(path, blob);
    if (error) throw new Error(error.message);
    return path;
  }

  /** Crea una entrega/recepción de vehículo desde la web (paridad app de campo).
   *  El RPC registra al usuario actual como conductor y exige las 6 fotos guiadas. */
  /**
   * W3 — pre-check ligero: ¿quién tiene este vehículo con recepción abierta?
   * Devuelve `null` si está libre. Respeta RLS (RPC security definer).
   */
  async entregaAbiertaDe(vehiculoId: string): Promise<EntregaAbierta | null> {
    const { data, error } = await this.supabase.client.rpc('entrega_abierta_de', {
      p_vehiculo_id: vehiculoId,
    });
    if (error) throw new Error(error.message);
    return (data as EntregaAbierta | null) ?? null;
  }

  async crearEntrega(p: {
    id: string;
    vehiculoId: string;
    tipo: 'recepcion' | 'devolucion';
    km: number;
    combustible: string;
    tieneDanos: boolean;
    danos: { zona: string; descripcion: string | null; foto_path: string | null }[];
    firmaUrl: string | null;
    fotos: { slot: string; path: string }[];
    gps: { lat: number; lng: number } | null;
    observacion: string | null;
    /** W3 — cerrar la recepción abierta de otro conductor y abrir la nueva. */
    forzarHandover?: boolean;
  }): Promise<string> {
    const { data, error } = await this.supabase.client.rpc('crear_entrega_vehiculo', {
      p_id: p.id,
      p_vehiculo_id: p.vehiculoId,
      p_tipo: p.tipo,
      p_km: p.km,
      p_combustible: p.combustible,
      p_tiene_danos: p.tieneDanos,
      p_danos: p.danos,
      p_firma_url: p.firmaUrl,
      p_fotos: p.fotos,
      p_gps: p.gps ?? {},
      p_capturado_en: null, // el servidor usa now()
      p_observacion: p.observacion,
      p_forzar_handover: p.forzarHandover ?? false,
    });
    if (error) {
      // W3 — el servidor pide handover (recepción abierta de otro conductor).
      if (error.hint === 'handover_requerido') {
        let info: EntregaAbierta | null = null;
        try {
          info = error.details ? (JSON.parse(error.details) as EntregaAbierta) : null;
        } catch {
          /* detalle no parseable → sin info estructurada */
        }
        throw new HandoverRequeridoError(error.message, info);
      }
      throw new Error(error.message);
    }
    return (data as string) ?? p.id;
  }

  /** Resolves a checklist photo/signature path to a cached signed URL (W9). */
  async getEntregaFotoUrl(path: string): Promise<string> {
    return this.cache.signed('vehiculos', path);
  }

  // ── Vehicle photos (sgc.vehiculos.fotos text[] + `vehiculos` bucket) ──────

  /** Uploads one photo for a vehicle and returns its storage path. */
  async uploadFoto(vehiculoId: string, file: File): Promise<string> {
    const safeName = (file.name || 'foto')
      .replace(/\.[^.]+$/, '')
      .replace(/[^a-zA-Z0-9_-]+/g, '-')
      .slice(0, 40) || 'foto';
    const path = `vehiculo/${vehiculoId}/${crypto.randomUUID()}-${safeName}.jpg`;
    const { error } = await this.supabase.client.storage
      .from('vehiculos')
      .upload(path, file, { upsert: true });
    if (error) throw new Error(error.message);
    return path;
  }

  /**
   * Resuelve un path de foto a una URL firmada CACHEADA (W9). Con `transform`
   * pide un thumbnail liviano (para listados); sin él, la original (detalle).
   */
  async getFotoUrl(path: string, transform?: ImgTransform): Promise<string | null> {
    return (await this.cache.signed('vehiculos', path, transform)) || null;
  }

  /** Persists the full list of photo paths on the vehicle row (AA19 — el orden del
   *  array ES el orden; `portada` fija la foto de portada, fallback fotos[0]). */
  async setFotos(vehiculoId: string, fotos: string[], portada?: string | null): Promise<void> {
    const patch: Record<string, unknown> = { fotos };
    if (portada !== undefined) patch['foto_portada'] = portada;
    const { error } = await this.supabase.client
      .from('vehiculos')
      .update(patch)
      .eq('id', vehiculoId);
    if (error) throw new Error(error.message);
  }

  // ── AF3 — Llaves del vehículo ──────────────────────────────────────────────
  /** Estado actual de ambas llaves. */
  async getLlaves(vehiculoId: string): Promise<VehiculoLlave[]> {
    const { data, error } = await this.supabase.client.rpc('llaves_de', { p_vehiculo_id: vehiculoId });
    if (error) throw new Error(error.message);
    return (data ?? []) as VehiculoLlave[];
  }

  /** Registra/actualiza una llave (upsert estado + append historial). */
  async setLlave(payload: {
    vehiculo_id: string;
    numero: 1 | 2;
    ubicacion_tipo: LlaveUbicacion;
    portador_usuario_id?: string | null;
    ubicacion_detalle?: string | null;
    nota?: string | null;
  }): Promise<void> {
    const { error } = await this.supabase.client.rpc('set_llave', {
      p_vehiculo_id: payload.vehiculo_id,
      p_numero: payload.numero,
      p_ubicacion_tipo: payload.ubicacion_tipo,
      p_portador_usuario_id: payload.portador_usuario_id ?? null,
      p_ubicacion_detalle: payload.ubicacion_detalle ?? null,
      p_nota: payload.nota ?? null,
    });
    if (error) throw new Error(error.message);
  }

  /** Historial de traspasos de las llaves de un vehículo. */
  async getLlaveTraspasos(vehiculoId: string): Promise<VehiculoLlaveTraspaso[]> {
    const { data, error } = await this.supabase.client.rpc('llave_traspasos_de', { p_vehiculo_id: vehiculoId });
    if (error) throw new Error(error.message);
    return (data ?? []) as VehiculoLlaveTraspaso[];
  }

  // ── AG8 — Placas provisionales (PP) + marbete DGII ─────────────────────────
  /** Proceso PP ACTIVO (no entregado) del vehículo, si existe. */
  async getPlacaPPActiva(vehiculoId: string): Promise<VehiculoPlacaPP | null> {
    const { data, error } = await this.supabase.client
      .schema('sgc')
      .from('vehiculo_placas_pp')
      .select('*')
      .eq('vehiculo_id', vehiculoId)
      .neq('estado', 'entregada')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (data as unknown as VehiculoPlacaPP) ?? null;
  }

  /** Ids de vehículos con un proceso PP ACTIVO (para el badge del listado). */
  async getVehiculosConPPActiva(): Promise<Record<string, PlacaPPEstado>> {
    const { data, error } = await this.supabase.client
      .schema('sgc')
      .from('vehiculo_placas_pp')
      .select('vehiculo_id, estado')
      .neq('estado', 'entregada');
    if (error) throw new Error(error.message);
    const map: Record<string, PlacaPPEstado> = {};
    for (const r of (data ?? []) as { vehiculo_id: string; estado: PlacaPPEstado }[]) map[r.vehiculo_id] = r.estado;
    return map;
  }

  /** Todo el historial de procesos PP del vehículo (entregados incluidos). */
  async getPlacasPP(vehiculoId: string): Promise<VehiculoPlacaPP[]> {
    const { data, error } = await this.supabase.client
      .schema('sgc')
      .from('vehiculo_placas_pp')
      .select('*')
      .eq('vehiculo_id', vehiculoId)
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as VehiculoPlacaPP[];
  }

  /** Extensiones de plazo de un proceso PP. */
  async getPlacaPPExtensiones(placaPPId: string): Promise<VehiculoPlacaPPExtension[]> {
    const { data, error } = await this.supabase.client
      .schema('sgc')
      .from('vehiculo_placa_pp_extensiones')
      .select('*')
      .eq('placa_pp_id', placaPPId)
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as VehiculoPlacaPPExtension[];
  }

  async crearPlacaPP(payload: {
    vehiculo_id: string;
    dealer: string | null;
    placa_pp: string | null;
    fecha_vencimiento: string | null;   // la que dice la placa (primaria)
    dias?: number | null;               // fallback si no dan la fecha
    fecha_registro?: string | null;
    fecha_entrega_prometida?: string | null;
    notas?: string | null;
  }): Promise<string> {
    const { data, error } = await this.supabase.client.rpc('crear_placa_pp', {
      p_vehiculo_id: payload.vehiculo_id,
      p_dealer: payload.dealer,
      p_placa_pp: payload.placa_pp,
      p_fecha_vencimiento: payload.fecha_vencimiento ?? null,
      p_dias: payload.dias ?? null,
      p_fecha_registro: payload.fecha_registro ?? null,
      p_fecha_entrega_prometida: payload.fecha_entrega_prometida ?? null,
      p_notas: payload.notas ?? null,
    });
    if (error) throw new Error(error.message);
    return data as string;
  }

  async ampliarPlacaPP(id: string, diasNuevos: number, motivo: string | null): Promise<void> {
    const { error } = await this.supabase.client.rpc('ampliar_placa_pp', {
      p_id: id, p_dias_nuevos: diasNuevos, p_motivo: motivo,
    });
    if (error) throw new Error(error.message);
  }

  async entregarPlacaPP(payload: { id: string; placa_definitiva: string; marbete: boolean; marbete_numero: string | null; fecha_entrega?: string | null }): Promise<void> {
    const { error } = await this.supabase.client.rpc('entregar_placa_pp', {
      p_id: payload.id,
      p_placa_definitiva: payload.placa_definitiva,
      p_marbete: payload.marbete,
      p_marbete_numero: payload.marbete_numero,
      p_fecha_entrega: payload.fecha_entrega ?? null,
    });
    if (error) throw new Error(error.message);
  }
}

// ── AG8 — tipos de placas provisionales ───────────────────────────────────────
export type PlacaPPEstado = 'pendiente' | 'entregada' | 'vencida';
export interface VehiculoPlacaPP {
  id: string;
  vehiculo_id: string;
  dealer: string | null;
  placa_pp: string | null;
  fecha_registro: string;
  // Días que el dealer prometió para la definitiva (seguimiento, opcional).
  dias_prometidos: number | null;
  // AG8b — vencimiento REGULADO de la PP (la fecha impresa en la placa) — primario.
  fecha_vencimiento_pp: string | null;
  // AG8b — fecha que el dealer prometió entregar la definitiva (seguimiento).
  fecha_entrega_prometida: string | null;
  fecha_limite: string;
  estado: PlacaPPEstado;
  placa_definitiva: string | null;
  marbete_dgii: boolean;
  marbete_numero: string | null;
  fecha_entrega: string | null;
  notas: string | null;
  created_at: string;
}
export interface VehiculoPlacaPPExtension {
  id: string;
  placa_pp_id: string;
  dias_agregados: number;
  fecha_limite_anterior: string | null;
  fecha_limite_nueva: string;
  motivo: string | null;
  created_at: string;
}

// ── AF3 — tipos de llaves ─────────────────────────────────────────────────────
export type LlaveUbicacion = 'chofer_asignado' | 'oficina_central' | 'otro';
export interface VehiculoLlave {
  numero: 1 | 2;
  ubicacion_tipo: LlaveUbicacion;
  portador_usuario_id: string | null;
  portador_nombre: string | null;
  ubicacion_detalle: string | null;
  updated_at: string;
}
export interface VehiculoLlaveTraspaso {
  numero: 1 | 2;
  ubicacion_tipo: LlaveUbicacion;
  portador_nombre: string | null;
  ubicacion_detalle: string | null;
  nota: string | null;
  registrado_nombre: string | null;
  created_at: string;
}
