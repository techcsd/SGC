import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';
import { APP_VERSION } from '../../environments/version';

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

  private plataformaReportada = false;

  /** Ping best-effort; nunca lanza (no debe romper la navegación ni el login). */
  ping(): void {
    // AQ7/AS3 — reporta la plataforma 'web' y su versión (APP_VERSION, SIEMPRE no-nula)
    // una vez por carga. Se hace ANTES del throttle para garantizar que la versión web
    // quede fresca aunque el primer ping caiga dentro de la ventana de throttle.
    // (La versión desfasada venía de reportes con null desde la app; la web nunca manda null.)
    if (!this.plataformaReportada) {
      this.plataformaReportada = true;
      void this.supabase.client
        .rpc('set_mi_plataforma', { p_plataforma: 'web', p_app_version: APP_VERSION })
        .then(() => undefined, () => undefined);
    }

    const ahora = Date.now();
    if (ahora - this.ultimoPing < this.MIN_MS) return;
    this.ultimoPing = ahora;
    void this.supabase.client
      .rpc('ping_actividad', { p_canal: 'web' })
      .then(() => undefined, () => undefined);
  }
}
