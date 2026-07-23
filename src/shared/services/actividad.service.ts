import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';

/**
 * W12 — registra la "última vez activo" del usuario en el canal web.
 * El servidor ya throttlea (máx. 1 update / 5 min por canal); aquí añadimos un
 * throttle de cliente para no llamar el RPC en cada navegación.
 */
@Injectable({ providedIn: 'root' })
export class ActividadService {
  private supabase = inject(SupabaseService);
  private ultimoPing = 0;
  /** No re-pingear más de una vez cada ~4 min desde el cliente. */
  private readonly MIN_MS = 4 * 60 * 1000;

  /** Ping best-effort; nunca lanza (no debe romper la navegación ni el login). */
  ping(): void {
    const ahora = Date.now();
    if (ahora - this.ultimoPing < this.MIN_MS) return;
    this.ultimoPing = ahora;
    void this.supabase.client
      .rpc('ping_actividad', { p_canal: 'web' })
      .then(() => undefined, () => undefined);
  }
}
