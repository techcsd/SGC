import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';

export interface AuditoriaFiltro {
  tabla?: string;
  accion?: string;
  actorId?: string;
  desde?: string; // yyyy-mm-dd
  hasta?: string; // yyyy-mm-dd
  buscar?: string; // registro_id / tabla
}

export interface AuditoriaRow {
  id: number;
  tabla: string;
  registro_id: string;
  accion: 'INSERT' | 'UPDATE' | 'DELETE';
  actor_id: string | null;
  actor?: { nombre: string } | null;
  // BC6/AZ10 — doble identidad: admin real que actuó "como" el actor durante una
  // sesión de impersonación (NULL en operación normal).
  impersonado_por?: string | null;
  impersonador?: { nombre: string } | null;
  cambios: Record<string, { antes: unknown; despues: unknown }> | null;
  datos_despues: Record<string, unknown> | null;
  datos_antes: Record<string, unknown> | null;
  creado_en: string;
}

export interface AuditoriaActor {
  actor_id: string;
  nombre: string;
}

/** AZ10 — fila del log de acciones de administración (audit_log): impersonación,
 *  cambios de rol, usuarios de prueba, etc. Distinto del change-log de tablas. */
export interface AdminAccionRow {
  id: string;
  action: string;
  actor_id: string | null;
  actor_nombre: string | null;
  target_user_id: string | null;
  target_nombre: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  total: number;
}

/** W6 — agregados analíticos del módulo de auditoría (RPC auditoria_resumen). */
export interface AuditoriaResumen {
  total: number;
  usuarios_activos: number;
  modulos_activos: number;
  por_usuario: { actor_id: string | null; nombre: string; n: number }[];
  por_modulo: { tabla: string; n: number }[];
  por_accion: { accion: string; n: number }[];
  por_dia: { dia: string; n: number }[];
  por_hora: { hora: number; n: number }[];
  acciones_comunes: { tabla: string; accion: string; n: number }[];
}

/** Reads the comprehensive change-audit log (sgc.auditoria). Server-side
 *  filtered + paginated (the log grows unbounded, unlike other SGC lists). */
@Injectable({ providedIn: 'root' })
export class AuditoriaService {
  private supabase = inject(SupabaseService);

  readonly pageSize = 40;

  /**
   * CD2 — la lista va por el RPC definer `auditoria_listar` (gate + cast + total por
   * window), no por un `.from('auditoria')` bajo RLS con embed. Independiente de RLS,
   * filtros aplicados en servidor. `total` viene en cada fila (0 si vacío).
   */
  async list(filtro: AuditoriaFiltro, page: number): Promise<{ rows: AuditoriaRow[]; total: number }> {
    const { data, error } = await this.supabase.client.rpc('auditoria_listar', {
      p_tabla: filtro.tabla || null,
      p_accion: filtro.accion || null,
      p_actor: filtro.actorId || null,
      p_desde: filtro.desde || null,
      p_hasta: filtro.hasta || null,
      p_buscar: filtro.buscar?.trim() || null,
      p_limite: this.pageSize,
      p_offset: page * this.pageSize,
    });
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as (AuditoriaRow & { total?: number })[];
    return { rows: rows as AuditoriaRow[], total: rows[0]?.total ?? 0 };
  }

  /** CD2 — opciones de filtro (tablas + actores) en UN solo RPC definer robusto. */
  async opciones(): Promise<{ tablas: string[]; actores: AuditoriaActor[] }> {
    const { data, error } = await this.supabase.client.rpc('auditoria_opciones');
    if (error) throw new Error(error.message);
    const d = (data ?? {}) as { tablas?: string[]; actores?: AuditoriaActor[] };
    return { tablas: d.tablas ?? [], actores: d.actores ?? [] };
  }

  /** Distinct tables present in the log (compat; prefer opciones()). */
  async tablas(): Promise<string[]> {
    return (await this.opciones()).tablas;
  }

  /** AZ10 — lista el log de acciones de administración (audit_log), paginado. */
  async listAdmin(page: number, action?: string): Promise<{ rows: AdminAccionRow[]; total: number }> {
    const { data, error } = await this.supabase.client.rpc('audit_log_listado', {
      p_limit: this.pageSize,
      p_offset: page * this.pageSize,
      p_action: action || null,
    });
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as AdminAccionRow[];
    return { rows, total: rows[0]?.total ?? 0 };
  }

  async actores(): Promise<AuditoriaActor[]> {
    const { data, error } = await this.supabase.client.rpc('auditoria_actores');
    if (error) throw new Error(error.message);
    return (data ?? []) as AuditoriaActor[];
  }

  /** W6 — agregados para el dashboard analítico (una sola llamada). */
  async resumen(filtro: Pick<AuditoriaFiltro, 'desde' | 'hasta' | 'actorId' | 'tabla'>): Promise<AuditoriaResumen> {
    const { data, error } = await this.supabase.client.rpc('auditoria_resumen', {
      p_desde: filtro.desde || null,
      p_hasta: filtro.hasta || null,
      p_actor: filtro.actorId || null,
      p_tabla: filtro.tabla || null,
    });
    if (error) throw new Error(error.message);
    return (data ?? {}) as AuditoriaResumen;
  }
}
