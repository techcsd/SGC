import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';

// AT1-AT4 — Incentivo semanal de choferes. Todos los cálculos y la autorización
// viven server-side (RPCs SECURITY DEFINER). Este servicio solo transporta.

export interface IncentivoSemanaRef {
  anio: number;
  semana: number;
  inicio: string;
  fin: string;
  choferes: number;
  cumplieron: number;
}

export interface IncentivoFila {
  informe_id: string;
  usuario_id: string;
  nombre: string;
  conductor_id: string | null;
  puntaje: number;
  minimo: number;
  cumplio: boolean;
  conteos: Record<string, ConteoRenglon>;
  // BB8 — cada flag trae su ref_tipo (ruta|echada), fecha y estado de decisión
  // (cuarentena|aceptada|excluida). Los flags legacy pueden no traerlos.
  flags: IncentivoFlag[];
  decision: 'aprobado' | 'declinado' | null;
  motivo: string | null;
  decidido_por: string | null;
  decidido_por_nombre: string | null;
  decidido_en: string | null;
}

/** BB8 — una incidencia (ruta 0km / echada duplicada) con su estado de cuarentena. */
export interface IncentivoFlag {
  tipo: string;                       // 'ruta_sin_metrica' | 'echada_duplicada'
  ref_id: string;
  ref_tipo?: 'ruta' | 'echada';       // legacy puede no traerlo
  fecha?: string | null;
  msg: string;
  decision?: 'cuarentena' | 'aceptada' | 'excluida';
}

export interface ConteoRenglon {
  propio: number;
  ayudante: number;
  puntos: number;
  refs: { id: string; tipo: string; fecha: string; ayudante: boolean }[];
}

export interface IncentivoDecision {
  decision: 'aprobado' | 'declinado';
  motivo: string | null;
  puntaje: number;
  config_version: number;
  decidido_por: string | null;
  decidido_por_nombre: string | null;
  decidido_en: string;
}

export interface IncentivoConfig {
  version: number;
  minimo_semanal: number;
  pesos: Record<string, number>;
  ayudante_factor: number;
  activo: boolean;
  nota: string | null;
}

export interface MiRendimientoSemana {
  informe_id: string;
  anio: number;
  semana: number;
  inicio: string;
  fin: string;
  puntaje: number;
  minimo: number;
  cumplio: boolean;
  conteos: Record<string, ConteoRenglon>;
  decision: 'aprobado' | 'declinado' | null;
  decidido_en: string | null;
}

/** BB8c — semana ISO actual (año + número), para mostrar el corte "en curso". */
export function isoSemanaActual(base: Date = new Date()): { anio: number; semana: number } {
  const d = new Date(Date.UTC(base.getFullYear(), base.getMonth(), base.getDate()));
  const dayNum = (d.getUTCDay() + 6) % 7; // lunes=0
  d.setUTCDate(d.getUTCDate() - dayNum + 3); // jueves de esta semana ISO
  const anio = d.getUTCFullYear();
  const jan4 = new Date(Date.UTC(anio, 0, 4));
  const week = 1 + Math.round(((d.getTime() - jan4.getTime()) / 86400000 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
  return { anio, semana: week };
}

/** Etiquetas legibles de los renglones (homologadas web/app). */
export const RENGLON_LABELS: Record<string, string> = {
  reporte_semanal: 'Reporte semanal',
  inspeccion: 'Inspección de vehículo',
  echada: 'Registro de combustible',
  ruta: 'Rutas completadas',
  conduce: 'Conduces confirmados',
};

@Injectable({ providedIn: 'root' })
export class IncentivosService {
  private supabase = inject(SupabaseService);

  async semanas(): Promise<IncentivoSemanaRef[]> {
    const { data, error } = await this.supabase.client.rpc('incentivo_semanas');
    if (error) throw new Error(error.message);
    return (data ?? []) as IncentivoSemanaRef[];
  }

  async listado(anio: number, semana: number): Promise<IncentivoFila[]> {
    const { data, error } = await this.supabase.client.rpc('incentivo_listado', { p_anio: anio, p_semana: semana });
    if (error) throw new Error(error.message);
    return (data ?? []) as IncentivoFila[];
  }

  async historial(informeId: string): Promise<IncentivoDecision[]> {
    const { data, error } = await this.supabase.client.rpc('incentivo_historial', { p_informe_id: informeId });
    if (error) throw new Error(error.message);
    return (data ?? []) as IncentivoDecision[];
  }

  async decidir(informeId: string, decision: 'aprobado' | 'declinado', motivo: string | null): Promise<void> {
    const { error } = await this.supabase.client.rpc('incentivo_decidir', {
      p_informe_id: informeId, p_decision: decision, p_motivo: motivo,
    });
    if (error) throw new Error(error.message);
  }

  async aprobarCumplieron(anio: number, semana: number): Promise<number> {
    const { data, error } = await this.supabase.client.rpc('incentivo_aprobar_cumplieron', { p_anio: anio, p_semana: semana });
    if (error) throw new Error(error.message);
    return (data ?? 0) as number;
  }

  /** BB8b — acepta (cuenta) o excluye (no cuenta) una incidencia; recalcula la semana. */
  async decidirIncidencia(
    anio: number, semana: number, refTipo: 'ruta' | 'echada', refId: string,
    decision: 'aceptada' | 'excluida', motivo: string | null = null,
  ): Promise<void> {
    const { error } = await this.supabase.client.rpc('incentivo_decidir_incidencia', {
      p_anio: anio, p_semana: semana, p_ref_tipo: refTipo, p_ref_id: refId,
      p_decision: decision, p_motivo: motivo,
    });
    if (error) throw new Error(error.message);
  }

  /** Recalcula el informe de la semana (idempotente) — para generar/refrescar a mano. */
  async generar(anio: number, semana: number): Promise<number> {
    const { data, error } = await this.supabase.client.rpc('incentivo_generar_semana', { p_anio: anio, p_semana: semana });
    if (error) throw new Error(error.message);
    return (data ?? 0) as number;
  }

  /** Reenvío manual del correo del incentivo (idempotente salvo forzar). */
  async enviar(anio: number, semana: number, forzar = false): Promise<string> {
    const { data, error } = await this.supabase.client.rpc('incentivo_enviar_semana', {
      p_anio: anio, p_semana: semana, p_forzar: forzar,
    });
    if (error) throw new Error(error.message);
    return (data ?? '') as string;
  }

  /** AV7 — quién recibe el informe semanal (por rol elevado, parametrizable). */
  async destinatariosInforme(): Promise<{ email: string; nombre: string }[]> {
    const { data, error } = await this.supabase.client.rpc('destinatarios_informe_incentivo');
    if (error) throw new Error(error.message);
    return (data ?? []) as { email: string; nombre: string }[];
  }

  async configActual(): Promise<IncentivoConfig | null> {
    const { data, error } = await this.supabase.client.rpc('incentivo_config_actual');
    if (error) throw new Error(error.message);
    return (data ?? null) as IncentivoConfig | null;
  }

  async setConfig(minimo: number, pesos: Record<string, number>, ayudanteFactor: number, nota: string | null): Promise<number> {
    const { data, error } = await this.supabase.client.rpc('incentivo_set_config', {
      p_minimo: minimo, p_pesos: pesos, p_ayudante_factor: ayudanteFactor, p_nota: nota,
    });
    if (error) throw new Error(error.message);
    return (data ?? 0) as number;
  }

  /** AX4 — configura la penalización por estancamiento sobre la config activa
   *  (no crea versión nueva). pts/día = 0 la deja apagada. */
  async setPenalizacion(graciaDias: number, ptsDia: number, tope: number): Promise<number> {
    const { data, error } = await this.supabase.client.rpc('incentivo_set_penalizacion', {
      p_gracia_dias: graciaDias, p_pts_dia: ptsDia, p_tope: tope,
    });
    if (error) throw new Error(error.message);
    return (data ?? 0) as number;
  }

  async miRendimiento(): Promise<MiRendimientoSemana[]> {
    const { data, error } = await this.supabase.client.rpc('incentivo_mi_rendimiento');
    if (error) throw new Error(error.message);
    return (data ?? []) as MiRendimientoSemana[];
  }
}
