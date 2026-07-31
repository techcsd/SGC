import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';
import { APP_VERSION } from '../../environments/version';
import { errorType } from '../utils/friendly-error.util';

/**
 * AD1 — Telemetría de errores *capturados* (los que la app maneja y muestra al
 * usuario como mensaje amable). Complementa a AppErrorHandler, que solo ve los
 * NO capturados. Reutiliza el RPC `report_app_error` (source='web'), con las
 * mismas defensas: solo con sesión activa, anti-loop y rate-limit por sesión.
 */
@Injectable({ providedIn: 'root' })
export class TelemetryService {
  private supabase = inject(SupabaseService);
  private sent = new Set<string>();
  private count = 0;
  private readonly MAX_PER_SESSION = 30;

  /** Reporta un error crudo que ya fue traducido y mostrado al usuario. */
  reportCaught(raw: string, context: Record<string, unknown> = {}): void {
    if (this.count >= this.MAX_PER_SESSION) return;
    const message = (raw ?? '').slice(0, 500);
    if (!message) return;
    const firma = message.slice(0, 120);
    if (this.sent.has(firma)) return;
    this.sent.add(firma);
    this.count++;
    void this.send(message, context);
  }

  private async send(message: string, context: Record<string, unknown>): Promise<void> {
    try {
      const { data: sess } = await this.supabase.client.auth.getSession();
      if (!sess.session) return;
      await this.supabase.client.rpc('report_app_error', {
        p_error_type: errorType(message),
        p_message: message,
        p_stack: '',
        p_context: { handled: true, url: location.pathname + location.search, ...context },
        p_device_brand: 'Navegador',
        p_device_model: 'Navegador',
        p_os_version: navigator.userAgent.slice(0, 60),
        p_app_version: APP_VERSION,
        p_platform: 'web',
        p_source: 'web',
      });
    } catch {
      /* anti-loop: nunca reportar el fallo del reporte */
    }
  }
}
