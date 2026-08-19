import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';
import {
  AppErrorReport,
  AppErrorGrupo,
  AppErrorFiltros,
  AppErrorEstado,
  AppErrorOcurrencia,
} from '../models/app-error-report.model';

const PAGE_SIZE = 50;

/**
 * Y6 — Lectura de reportes de errores de la app (panel Tecnología).
 * La escritura la hace la app vía RPC `report_app_error`; aquí solo lectura,
 * gateada por RLS (`es_tecnologia()`).
 */
@Injectable({ providedIn: 'root' })
export class AppErrorReportsService {
  private supabase = inject(SupabaseService);
  readonly pageSize = PAGE_SIZE;

  /** Página de reportes con filtros. Devuelve filas + total para paginar. */
  async getReports(
    filtros: AppErrorFiltros,
    page = 0,
  ): Promise<{ rows: AppErrorReport[]; total: number }> {
    let q = this.supabase.client
      .from('app_error_reports')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false });

    if (filtros.errorType) q = q.eq('error_type', filtros.errorType);
    if (filtros.source) q = q.eq('source', filtros.source);
    if (filtros.deviceModel) q = q.ilike('device_model', `%${filtros.deviceModel}%`);
    if (filtros.deviceBrand) q = q.ilike('device_brand', `%${filtros.deviceBrand}%`);
    if (filtros.appVersion) q = q.eq('app_version', filtros.appVersion);
    if (filtros.desde) q = q.gte('created_at', filtros.desde);
    if (filtros.hasta) q = q.lte('created_at', filtros.hasta);

    const from = page * PAGE_SIZE;
    q = q.range(from, from + PAGE_SIZE - 1);

    const { data, error, count } = await q;
    if (error) throw new Error(error.message);
    return { rows: (data ?? []) as AppErrorReport[], total: count ?? 0 };
  }

  /** Agrupación por firma de mensaje (contador de ocurrencias + estado) vía RPC. */
  async getGrupos(filtros: AppErrorFiltros): Promise<AppErrorGrupo[]> {
    const { data, error } = await this.supabase.client.rpc('app_error_reports_grupos', {
      p_desde: filtros.desde ?? null,
      p_hasta: filtros.hasta ?? null,
      p_error_type: filtros.errorType ?? null,
      p_limit: 200,
      p_source: filtros.source ?? null,
      p_estado: filtros.estado ?? null,
    });
    if (error) throw new Error(error.message);
    return (data ?? []) as AppErrorGrupo[];
  }

  /** AW14 — ocurrencias individuales de una firma (con usuario + metadata). */
  async getOcurrencias(firma: string, limit = 100): Promise<AppErrorOcurrencia[]> {
    const { data, error } = await this.supabase.client.rpc('app_error_reports_por_firma', {
      p_firma: firma,
      p_limit: limit,
    });
    if (error) throw new Error(error.message);
    return (data ?? []) as AppErrorOcurrencia[];
  }

  /** AW14 — marca el estado de atención de una firma (solo tecnología/admin). */
  async marcarEstado(firma: string, estado: AppErrorEstado, nota?: string | null): Promise<void> {
    const { error } = await this.supabase.client.rpc('marcar_error_estado', {
      p_firma: firma,
      p_estado: estado,
      p_nota: nota ?? null,
    });
    if (error) throw new Error(error.message);
  }

  /** Distintos modelos de dispositivo vistos (para el filtro). */
  async getDeviceModels(): Promise<string[]> {
    const { data, error } = await this.supabase.client
      .from('app_error_reports')
      .select('device_model')
      .not('device_model', 'is', null)
      .limit(1000);
    if (error) return [];
    const set = new Set((data ?? []).map((r) => (r as { device_model: string }).device_model));
    return [...set].sort();
  }
}
