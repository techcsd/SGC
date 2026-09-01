import { Injectable, computed, inject, signal } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'sgc-theme';

/**
 * ThemeService — BE6. Tema claro/oscuro por usuario.
 *
 * Estrategia: localStorage manda para el pintado INSTANTÁNEO (sin parpadeo; el
 * `index.html` ya aplicó el cacheado antes de arrancar Angular). El servidor
 * (`mi_tema`/`set_tema`, migración BE6) sincroniza entre dispositivos en
 * best-effort — si la migración aún no se aplicó, el toggle sigue funcionando
 * por dispositivo y nada se rompe. Default: claro.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private supabase = inject(SupabaseService);

  private _theme = signal<Theme>(this.readCached());
  readonly theme = this._theme.asReadonly();
  readonly isDark = computed(() => this._theme() === 'dark');

  constructor() {
    // Refuerza el atributo por si el script inline del index no corrió.
    this.applyToDom(this._theme());
  }

  private readCached(): Theme {
    try {
      return localStorage.getItem(STORAGE_KEY) === 'dark' ? 'dark' : 'light';
    } catch {
      return 'light';
    }
  }

  private cache(t: Theme): void {
    try {
      localStorage.setItem(STORAGE_KEY, t);
    } catch {
      /* almacenamiento no disponible: seguimos en memoria */
    }
  }

  private applyToDom(t: Theme): void {
    document.documentElement.setAttribute('data-theme', t);
  }

  /** Reconciliación con el servidor (tras login). Best-effort. */
  async syncFromServer(): Promise<void> {
    try {
      const { data, error } = await this.supabase.client.rpc('mi_tema');
      if (error) return;
      const serverTheme: Theme = data === 'oscuro' ? 'dark' : 'light';
      if (serverTheme !== this._theme()) {
        this._theme.set(serverTheme);
        this.applyToDom(serverTheme);
        this.cache(serverTheme);
      }
    } catch {
      /* RPC ausente (migración sin aplicar) → localStorage sigue mandando */
    }
  }

  /** Cambia el tema: pinta al instante, cachea y persiste (best-effort). */
  async set(t: Theme): Promise<void> {
    this._theme.set(t);
    this.applyToDom(t);
    this.cache(t);
    try {
      await this.supabase.client.rpc('set_tema', { p_tema: t === 'dark' ? 'oscuro' : 'claro' });
    } catch {
      /* sin servidor: queda guardado por dispositivo */
    }
  }

  toggle(): void {
    void this.set(this.isDark() ? 'light' : 'dark');
  }
}
