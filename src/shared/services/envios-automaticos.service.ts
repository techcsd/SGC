import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';

/** CT10 — una familia de reporte/aviso automático (crons) con su interruptor. */
export interface EnvioAutomatico {
  familia: string;
  nombre: string;
  activo: boolean;
  ultimo_envio: string | null;
  motivo_ultimo_cambio: string | null;
  cambiado_por: string | null;
  updated_at: string;
}

/**
 * CT10 — antes no existía ningún interruptor para los correos/avisos automáticos
 * de los crons (Resumen semanal de operaciones, Incentivo semanal, Avisos de
 * reporte semanal, Cronograma); lo único posible era desprogramar el cron a
 * mano. `sgc.envios_automaticos` (una fila por familia) + los 4 puntos de
 * entrada de cron ya la consultan (`sgc.envio_automatico_activo`).
 */
@Injectable({ providedIn: 'root' })
export class EnviosAutomaticosService {
  private supabase = inject(SupabaseService);

  async listar(): Promise<EnvioAutomatico[]> {
    const { data, error } = await this.supabase.client.rpc('envios_automaticos_listar');
    if (error) throw new Error(error.message);
    return (data ?? []) as EnvioAutomatico[];
  }

  async set(familia: string, activo: boolean, motivo?: string | null): Promise<void> {
    const { error } = await this.supabase.client.rpc('envio_automatico_set', {
      p_familia: familia,
      p_activo: activo,
      p_motivo: motivo ?? null,
    });
    if (error) throw new Error(error.message);
  }

  /** CU3 — "Enviar prueba ahora (solo a mí)": ignora el interruptor, manda solo
   * al admin que la pide. Devuelve el correo al que se mandó. Solo aplica a las
   * familias que son correo a una lista (el servidor rechaza las demás). */
  async probar(familia: string): Promise<string> {
    const { data, error } = await this.supabase.client.rpc('envio_automatico_probar', { p_familia: familia });
    if (error) throw new Error(error.message);
    return data as string;
  }

  // ── DB10/DB11 — bloque «Quién recibe» (roles + personas extra por familia) ──
  /** Lee varios parámetros de una vez (clave → valor; ausente = sin fila). */
  async getParametros(claves: string[]): Promise<Record<string, string>> {
    const { data, error } = await this.supabase.client
      .from('parametros')
      .select('clave, valor')
      .in('clave', claves);
    if (error) throw new Error(error.message);
    const map: Record<string, string> = {};
    for (const r of (data ?? []) as { clave: string; valor: string }[]) map[r.clave] = r.valor;
    return map;
  }

  /** Upsert de un parámetro (la fila de roles puede no existir aún: vive del default). */
  async setParametro(clave: string, valor: string, descripcion: string): Promise<void> {
    const { error } = await this.supabase.client
      .from('parametros')
      .upsert({ clave, valor, descripcion, updated_at: new Date().toISOString() }, { onConflict: 'clave' });
    if (error) throw new Error(error.message);
  }

  /** Vista previa de a quién le llegaría HOY (misma función que usa el cron). */
  async destinatarios(familia: 'resumen_operaciones' | 'rendimiento_vehiculos'): Promise<{ email: string; nombre: string }[]> {
    const fn = familia === 'resumen_operaciones' ? 'destinatarios_resumen_operaciones' : 'destinatarios_rendimiento_vehiculos';
    const { data, error } = await this.supabase.client.rpc(fn);
    if (error) throw new Error(error.message);
    return (data ?? []) as { email: string; nombre: string }[];
  }
}
