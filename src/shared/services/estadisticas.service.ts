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
  /** AS3 — versión publicada más alta por plataforma del catálogo ('web' | 'movil'). */
  versiones_ultimas?: Record<string, string> | null;
}

/** AR2 — un dispositivo del historial de un usuario. */
export interface DispositivoHist {
  plataforma: string | null;
  modelo: string | null;
  app_version: string | null;
  build_number?: number | null;
  visto_at: string;
  usos: number;
}

/** AR2/AS3 — fila por usuario (RPC sgc.dispositivos_por_usuario). */
export interface DispositivoUsuario {
  usuario_id: string;
  nombre: string;
  email: string | null;
  roles: string[];
  plataforma: string | null;
  modelo: string | null;
  app_version: string | null;
  /** AS3 — build del cliente (opcional, lo poblará la app en PROMPT-2). */
  build_number?: number | null;
  ultimo_uso: string | null;
  /** AS3 — máximo entre actividad web/app y el visto_at más reciente del dispositivo. */
  last_seen_at?: string | null;
  /** AS3 — la versión reportada es < a la publicada de su plataforma. null app_version = "sin dato". */
  obsoleta?: boolean;
  dispositivos_total: number;
  historial: DispositivoHist[];
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

  /** AR2 — dispositivos por usuario (con historial). Gated es_tecnologia() server-side. */
  async getDispositivosPorUsuario(): Promise<DispositivoUsuario[]> {
    const { data, error } = await this.supabase.client.rpc('dispositivos_por_usuario');
    if (error) throw new Error(error.message);
    return (data ?? []) as DispositivoUsuario[];
  }
}
