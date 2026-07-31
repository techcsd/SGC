import { ErrorHandler, Injectable, Injector, inject } from '@angular/core';
import { SupabaseService } from './services/supabase.service';
import { APP_VERSION } from '../../environments/version';
import { isChunkLoadError, reloadForNewVersion } from '../../shared/utils/chunk-reload.util';

// "ResizeObserver loop completed with undelivered notifications" is a
// harmless browser quirk — not an actionable app error. Filter it out.
//
// Z28 — además de loguear, reporta los errores no capturados a
// `report_app_error` con source='web' (mismo panel que la app móvil):
// sanitizado, anti-loop (no reporta errores generados al reportar) y con
// rate-limit de cliente. Solo con sesión activa (el RPC exige authenticated).
@Injectable()
export class AppErrorHandler implements ErrorHandler {
  private injector = inject(Injector);
  private reporting = false;
  private sent = new Set<string>();
  private count = 0;
  private readonly MAX_PER_SESSION = 15;

  handleError(error: unknown): void {
    if (this.isBenignResizeObserverNoise(error)) return;
    // Chunk viejo tras un deploy: en vez de dejar la pantalla rota, recargamos
    // una vez para adoptar la versión nueva (anti-bucle dentro del helper).
    if (isChunkLoadError(error)) {
      console.warn('[sgc] Módulo desactualizado tras un deploy — recargando a la versión nueva.', error);
      reloadForNewVersion();
      return;
    }
    console.error(error);
    void this.report(error);
  }

  private async report(error: unknown): Promise<void> {
    if (this.reporting || this.count >= this.MAX_PER_SESSION) return;
    const message = (this.extractMessage(error) ?? String(error)).slice(0, 500);
    if (/ChunkLoadError|Loading chunk|NG0100|ExpressionChanged|ResizeObserver/i.test(message)) return;
    const firma = message.slice(0, 120);
    if (this.sent.has(firma)) return;

    this.reporting = true;
    try {
      const supabase = this.injector.get(SupabaseService);
      const { data: sess } = await supabase.client.auth.getSession();
      if (!sess.session) return;
      this.sent.add(firma);
      this.count++;
      const stack = (error as { stack?: string })?.stack ?? '';
      await supabase.client.rpc('report_app_error', {
        p_error_type: 'error',
        p_message: message,
        p_stack: stack.slice(0, 4000),
        p_context: { url: location.pathname + location.search },
        p_device_brand: this.browser(),
        p_device_model: 'Navegador',
        p_os_version: navigator.userAgent.slice(0, 60),
        p_app_version: APP_VERSION,
        p_platform: 'web',
        p_source: 'web',
      });
    } catch {
      /* anti-loop: nunca reportar el fallo del reporte */
    } finally {
      this.reporting = false;
    }
  }

  private browser(): string {
    const ua = navigator.userAgent;
    if (/Edg\//.test(ua)) return 'Edge';
    if (/OPR\//.test(ua)) return 'Opera';
    if (/Chrome\//.test(ua)) return 'Chrome';
    if (/Firefox\//.test(ua)) return 'Firefox';
    if (/Safari\//.test(ua)) return 'Safari';
    return 'Navegador';
  }

  private isBenignResizeObserverNoise(error: unknown): boolean {
    return this.extractMessage(error)?.includes('ResizeObserver loop completed') ?? false;
  }

  private extractMessage(error: unknown): string | undefined {
    if (!error || typeof error !== 'object') return undefined;
    const err = error as { message?: unknown; cause?: { message?: unknown } };
    return (typeof err.message === 'string' ? err.message : undefined)
      ?? (typeof err.cause?.message === 'string' ? err.cause.message : undefined);
  }
}
