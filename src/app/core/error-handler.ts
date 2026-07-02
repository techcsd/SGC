import { ErrorHandler, Injectable } from '@angular/core';

// "ResizeObserver loop completed with undelivered notifications" is a
// harmless browser quirk (fires when a ResizeObserver callback triggers a
// layout change that would need another cycle in the same frame) — not an
// actionable app error. provideBrowserGlobalErrorListeners() forwards it
// here regardless, so filter it out before it hits the console as a false
// alarm; everything else still logs normally.
@Injectable()
export class AppErrorHandler implements ErrorHandler {
  handleError(error: unknown): void {
    if (this.isBenignResizeObserverNoise(error)) return;
    console.error(error);
  }

  private isBenignResizeObserverNoise(error: unknown): boolean {
    const message = this.extractMessage(error);
    return message?.includes('ResizeObserver loop completed') ?? false;
  }

  private extractMessage(error: unknown): string | undefined {
    if (!error || typeof error !== 'object') return undefined;
    const err = error as { message?: unknown; cause?: { message?: unknown } };
    return (typeof err.message === 'string' ? err.message : undefined)
      ?? (typeof err.cause?.message === 'string' ? err.cause.message : undefined);
  }
}
