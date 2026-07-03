import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';

@Injectable({ providedIn: 'root' })
export class NotificarEntregaService {
  private supabase = inject(SupabaseService);

  /** Fire-and-forget — a notification failure must never block the real confirmation workflow. */
  notificarEntregaIncompleta(salidaId: string): void {
    this.supabase.client.functions.invoke('notificar-entrega', { body: { salidaId } }).catch((e) => {
      console.error('notificar-entrega failed', e);
    });
  }
}
