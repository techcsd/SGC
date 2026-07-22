import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';
import { Vehiculo, VehiculoFormData } from '../models/vehiculo.model';
import { VehiculoAsignacion, VehiculoStats } from '../models/vehiculo-asignacion.model';

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
    });
    if (error) throw new Error(error.message);
    return (data as string) ?? p.id;
  }

  /** Resolves a checklist photo/signature path to a time-limited signed URL. */
  async getEntregaFotoUrl(path: string): Promise<string> {
    const { data, error } = await this.supabase.client.storage
      .from('vehiculos')
      .createSignedUrl(path, 3600);
    if (error) throw new Error(error.message);
    return data.signedUrl;
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

  /** Resolves a stored photo path to a time-limited signed URL (null on failure). */
  async getFotoUrl(path: string): Promise<string | null> {
    const { data, error } = await this.supabase.client.storage
      .from('vehiculos')
      .createSignedUrl(path, 3600);
    if (error) return null;
    return data.signedUrl;
  }

  /** Persists the full list of photo paths on the vehicle row. */
  async setFotos(vehiculoId: string, fotos: string[]): Promise<void> {
    const { error } = await this.supabase.client
      .from('vehiculos')
      .update({ fotos })
      .eq('id', vehiculoId);
    if (error) throw new Error(error.message);
  }
}
