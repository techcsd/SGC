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
}
