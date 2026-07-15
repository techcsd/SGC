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
  cambios: Record<string, { antes: unknown; despues: unknown }> | null;
  datos_despues: Record<string, unknown> | null;
  datos_antes: Record<string, unknown> | null;
  creado_en: string;
}

export interface AuditoriaActor {
  actor_id: string;
  nombre: string;
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

const SELECT_QUERY =
  '*, actor:usuarios!auditoria_actor_id_fkey(nombre)';

/** Reads the comprehensive change-audit log (sgc.auditoria). Server-side
 *  filtered + paginated (the log grows unbounded, unlike other SGC lists). */
@Injectable({ providedIn: 'root' })
export class AuditoriaService {
  private supabase = inject(SupabaseService);

  readonly pageSize = 40;

  async list(filtro: AuditoriaFiltro, page: number): Promise<{ rows: AuditoriaRow[]; total: number }> {
    let q = this.supabase.client
      .from('auditoria')
      .select(SELECT_QUERY, { count: 'exact' })
      .order('creado_en', { ascending: false });

    if (filtro.tabla) q = q.eq('tabla', filtro.tabla);
    if (filtro.accion) q = q.eq('accion', filtro.accion);
    if (filtro.actorId) q = q.eq('actor_id', filtro.actorId);
    if (filtro.desde) q = q.gte('creado_en', filtro.desde);
    if (filtro.hasta) q = q.lte('creado_en', filtro.hasta + 'T23:59:59');
    if (filtro.buscar?.trim()) {
      const s = filtro.buscar.trim();
      q = q.or(`registro_id.ilike.%${s}%,tabla.ilike.%${s}%`);
    }

    const from = page * this.pageSize;
    q = q.range(from, from + this.pageSize - 1);

    const { data, error, count } = await q;
    if (error) throw new Error(error.message);
    return { rows: (data ?? []) as unknown as AuditoriaRow[], total: count ?? 0 };
  }

  /** Distinct tables present in the log (for the filter dropdown). */
  async tablas(): Promise<string[]> {
    // A cheap distinct: pull recent rows' tables. For a definitive list we could
    // add an RPC, but the label map covers naming; this keeps the dropdown honest.
    const { data, error } = await this.supabase.client
      .from('auditoria')
      .select('tabla')
      .order('tabla', { ascending: true })
      .limit(1000);
    if (error) throw new Error(error.message);
    return [...new Set((data ?? []).map((r: { tabla: string }) => r.tabla))];
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
