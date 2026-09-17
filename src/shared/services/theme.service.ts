import { Injectable, computed, inject, signal } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';

export type Theme = 'light' | 'dark';
/** BS3 — preferencia de tema del usuario: claro/oscuro fijo o "sistema" (sigue al SO). */
export type TemaPreferencia = 'claro' | 'oscuro' | 'sistema';

const STORAGE_KEY = 'sgc-theme';
const PREF_KEY = 'sgc-theme-pref';

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

  // BS3 — preferencia elegida por el usuario (claro/oscuro/sistema). `theme` es el
  // tema EFECTIVO ya resuelto; `preferencia` es lo que el usuario seleccionó.
  private _preferencia = signal<TemaPreferencia>(this.readCachedPref());
  readonly preferencia = this._preferencia.asReadonly();

  constructor() {
    // Refuerza el atributo por si el script inline del index no corrió.
    this.applyToDom(this._theme());
    // Si la preferencia es "sistema", reacciona a los cambios del SO.
    try {
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
        if (this._preferencia() === 'sistema') this.aplicarPreferencia('sistema', false);
      });
    } catch {
      /* matchMedia no disponible */
    }
  }

  private readCachedPref(): TemaPreferencia {
    try {
      const p = localStorage.getItem(PREF_KEY);
      return p === 'claro' || p === 'oscuro' || p === 'sistema' ? p : (this._theme() === 'dark' ? 'oscuro' : 'claro');
    } catch {
      return 'claro';
    }
  }

  /** Resuelve "sistema" a light/dark según el SO. */
  private resolver(pref: TemaPreferencia): Theme {
    if (pref === 'claro') return 'light';
    if (pref === 'oscuro') return 'dark';
    try {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    } catch {
      return 'light';
    }
  }

  /** BS3 — aplica una preferencia (claro/oscuro/sistema): resuelve, pinta, cachea y
   *  persiste en el servidor si `persistir`. */
  async aplicarPreferencia(pref: TemaPreferencia, persistir = true): Promise<void> {
    this._preferencia.set(pref);
    const efectivo = this.resolver(pref);
    this._theme.set(efectivo);
    this.applyToDom(efectivo);
    this.cache(efectivo);
    try {
      localStorage.setItem(PREF_KEY, pref);
    } catch {
      /* best-effort */
    }
    if (persistir) {
      try {
        await this.supabase.client.rpc('set_mi_preferencia', { p_clave: 'tema', p_valor: pref });
      } catch {
        /* sin servidor: queda por dispositivo */
      }
    }
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

  /** Reconciliación con el servidor (tras login). Best-effort. Acepta la nueva
   *  preferencia 'sistema' (BS3) además de claro/oscuro. */
  async syncFromServer(): Promise<void> {
    try {
      const { data, error } = await this.supabase.client.rpc('mi_tema');
      if (error) return;
      const pref: TemaPreferencia =
        data === 'sistema' ? 'sistema' : data === 'oscuro' ? 'oscuro' : 'claro';
      // No re-escribe el servidor (persistir=false): solo adopta lo que ya guardó.
      await this.aplicarPreferencia(pref, false);
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
