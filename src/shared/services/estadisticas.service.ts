import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';

/** AQ7 — payload de estadísticas de uso (RPC sgc.estadisticas_uso). */
export interface EstadisticasUso {
  generado_at: string;
  total_usuarios: number;
  activos_dia: number;
  activos_semana: number;
  activos_mes: number;
  web_semana: number;
  app_semana: number;
  dispositivos: { plataforma: string; total: number }[];
  app_android_tokens: number;
  versiones: { plataforma: string; version: string; publicada: boolean; fecha: string | null }[];
}

@Injectable({ providedIn: 'root' })
export class EstadisticasService {
  private supabase = inject(SupabaseService);

  /** AQ7 — estadísticas de uso (web/app, dispositivos, versiones). Gated es_tecnologia() server-side. */
  async getUso(): Promise<EstadisticasUso | null> {
    const { data, error } = await this.supabase.client.rpc('estadisticas_uso');
    if (error) throw new Error(error.message);
    if (!data || Object.keys(data).length === 0) return null; // sin permiso / vacío
    return data as EstadisticasUso;
  }
}
