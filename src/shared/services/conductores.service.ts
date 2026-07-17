import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';
import {
  Conductor,
  ConductorFormData,
  LicenciaCategoria,
  LICENCIA_CATEGORIAS_FALLBACK,
} from '../models/conductor.model';
import { ConductorStats } from '../models/vehiculo-asignacion.model';
import { sanitizeUuidFields } from '../utils/uuid.util';

/** C2 — uuid opcionales de un payload de conductor a sanear antes de escribir. */
const CONDUCTOR_UUID_FIELDS = ['usuario_id', 'vehiculo_id'] as const;

/** C7 — resumen de documentos destacados por conductor (vista v_conductor_documentos). */
export interface ConductorDocumentosResumen {
  conductor_id: string;
  tiene_cedula: boolean;
  tiene_licencia: boolean;
  total_documentos: number;
}

/** Usuario enlazable a un conductor + datos de su ficha para autollenar (B4/U3). */
export interface UsuarioVinculable {
  id: string;
  nombre: string;
  cedula: string | null;
  telefono: string | null;
  email: string | null;
}

@Injectable({ providedIn: 'root' })
export class ConductoresService {
  private supabase = inject(SupabaseService);

  /**
   * C1 — catálogo de categorías de licencia RD (`sgc.licencia_categorias`).
   * Cae al fallback local si la tabla no responde, para no dejar el select vacío.
   */
  async getCategoriasLicencia(): Promise<LicenciaCategoria[]> {
    const { data, error } = await this.supabase.client
      .from('licencia_categorias')
      .select('codigo, nombre, clase, orden, activo')
      .eq('activo', true)
      .order('orden');
    if (error || !data || data.length === 0) return LICENCIA_CATEGORIAS_FALLBACK;
    return data as unknown as LicenciaCategoria[];
  }

  async getAll(): Promise<Conductor[]> {
    const { data, error } = await this.supabase.client
      .from('conductores')
      .select('*, vehiculo:vehiculos(placa, marca, modelo), usuario:usuarios(nombre)')
      .order('nombre');

    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as Conductor[];
  }

  /**
   * C7 — resumen de documentos destacados por conductor, para el badge de
   * "documentos incompletos" en el listado sin cargar todos los docs por fila.
   * Devuelve [] si la vista aún no existe (no rompe el listado).
   */
  async getDocumentosResumen(): Promise<ConductorDocumentosResumen[]> {
    const { data, error } = await this.supabase.client
      .from('v_conductor_documentos')
      .select('conductor_id, tiene_cedula, tiene_licencia, total_documentos');
    if (error) return [];
    return (data ?? []) as unknown as ConductorDocumentosResumen[];
  }

  /** Un conductor con sus joins (perfil, R5). */
  async getById(id: string): Promise<Conductor | null> {
    const { data, error } = await this.supabase.client
      .from('conductores')
      .select('*, vehiculo:vehiculos(placa, marca, modelo), usuario:usuarios(nombre)')
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (data as unknown as Conductor) ?? null;
  }

  /** Stats agregados del conductor (vista sgc.v_conductor_stats, R5). */
  async getStats(conductorId: string): Promise<ConductorStats | null> {
    const { data, error } = await this.supabase.client
      .from('v_conductor_stats')
      .select('*')
      .eq('conductor_id', conductorId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (data as unknown as ConductorStats) ?? null;
  }

  /** Auto-registro de conductor sin aprobación (RPC, R2). */
  async autoRegistrar(payload: {
    cedula: string;
    licencia_tipo: string;
    licencia_numero?: string | null;
    licencia_vencimiento?: string | null;
    tipo_vehiculo_autorizado?: string;
  }): Promise<Record<string, unknown>> {
    const { data, error } = await this.supabase.client.rpc('auto_registrar_conductor', {
      p_cedula: payload.cedula,
      p_licencia_tipo: payload.licencia_tipo,
      p_licencia_numero: payload.licencia_numero ?? null,
      p_licencia_vencimiento: payload.licencia_vencimiento ?? null,
      p_tipo_vehiculo_autorizado: payload.tipo_vehiculo_autorizado ?? 'Ambos',
    });
    if (error) throw new Error(error.message);
    return (data ?? {}) as Record<string, unknown>;
  }

  async create(payload: ConductorFormData): Promise<Conductor> {
    const { data, error } = await this.supabase.client
      .from('conductores')
      .insert(sanitizeUuidFields(payload, CONDUCTOR_UUID_FIELDS))
      .select('*, vehiculo:vehiculos(placa, marca, modelo), usuario:usuarios(nombre)')
      .single();

    if (error) throw new Error(error.message);
    return data as unknown as Conductor;
  }

  async update(id: string, payload: Partial<ConductorFormData>): Promise<Conductor> {
    const { data, error } = await this.supabase.client
      .from('conductores')
      .update({ ...sanitizeUuidFields(payload, CONDUCTOR_UUID_FIELDS), updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('*, vehiculo:vehiculos(placa, marca, modelo), usuario:usuarios(nombre)')
      .single();

    if (error) throw new Error(error.message);
    return data as unknown as Conductor;
  }

  /**
   * Active app users, for linking a driver to their CSD App account. B4/U3 — trae
   * también cédula y teléfono (de la ficha de empleado, vía RPC SECURITY DEFINER
   * gated a flota/rrhh/admin) para autollenar el form al enlazar.
   */
  async getUsuariosVinculables(): Promise<UsuarioVinculable[]> {
    const { data, error } = await this.supabase.client.rpc('usuarios_vinculables');
    if (error) throw new Error(error.message);
    return (data ?? []) as UsuarioVinculable[];
  }

  async toggleActivo(id: string, activo: boolean): Promise<void> {
    const { error } = await this.supabase.client
      .from('conductores')
      .update({ activo, updated_at: new Date().toISOString() })
      .eq('id', id);

    if (error) throw new Error(error.message);
  }
}
