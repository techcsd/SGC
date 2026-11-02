import { Injectable, inject, signal } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';

export type PulsoSistemaEstado = 'activo' | 'sin_actividad' | 'atencion' | 'error';

export interface PulsoSistemaFila {
  sistema: string;
  estado: PulsoSistemaEstado;
  detalle: string;
  ultima_actividad: string | null;
}

/** F6c (ronda DF) — "Pulso del sistema" en Administración: línea de vida por
 * sistema (BD, crons, cola de envíos, STT, IA, GPS), vía sgc.pulso_sistema(). */
@Injectable({ providedIn: 'root' })
export class PulsoSistemaService {
  private supabase = inject(SupabaseService);

  private _filas = signal<PulsoSistemaFila[]>([]);
  filas = this._filas.asReadonly();

  async cargar(): Promise<void> {
    const { data, error } = await this.supabase.client.rpc('pulso_sistema');
    if (error) throw error;
    this._filas.set((data ?? []) as PulsoSistemaFila[]);
  }
}
