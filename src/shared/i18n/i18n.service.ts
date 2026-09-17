import { inject, Injectable, signal } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';

/** BS4 — idiomas soportados. `es` es el idioma base (las CLAVES de traducción SON
 *  el texto en español, así que `es` nunca necesita catálogo). `en` y `ht` (kreyòl)
 *  son superposiciones: una clave sin traducir cae al español. `ht` arranca vacío. */
export type Idioma = 'es' | 'en' | 'ht';

export const IDIOMAS: { code: Idioma; nativo: string; bandera: string }[] = [
  { code: 'es', nativo: 'Español', bandera: '🇩🇴' },
  { code: 'en', nativo: 'English', bandera: '🇺🇸' },
  { code: 'ht', nativo: 'Kreyòl ayisyen', bandera: '🇭🇹' },
];

const LS_KEY = 'sgc.idioma';

/**
 * BS4 — selector de idioma en runtime, sin `@angular/localize` (que obligaría a un
 * build por idioma). Diccionario en memoria con signals: cambiar el idioma
 * re-renderiza sin recargar. Las CLAVES son el texto en español; `t()` devuelve el
 * español tal cual cuando el idioma es `es` o cuando la traducción no existe →
 * nunca se ve una clave cruda en pantalla.
 *
 * Portado del hijo (csd-app) — 1ª vez que el hijo es la referencia de
 * infraestructura (ver PARIDAD.md). Diferencia: aquí la persistencia local es
 * `localStorage` (no Capacitor Preferences) y el idioma canónico vive en
 * `usuarios.idioma` (RPC `mi_idioma_set`, compartido con la app).
 *
 * Los textos que vienen del SERVIDOR (catálogos, nombres de obra, mensajes de
 * negocio) siguen en español — no pasan por aquí (documentado en Configuración).
 */
@Injectable({ providedIn: 'root' })
export class I18nService {
  private supabase = inject(SupabaseService);

  /** Idioma activo. Cualquier `t()` que lo lea se vuelve reactivo al cambio. */
  private _idioma = signal<Idioma>('es');
  idioma = this._idioma.asReadonly();

  /** Catálogos cargados: { idioma: { textoEs: traducción } }. `es` no necesita uno. */
  private catalogos = signal<Partial<Record<Idioma, Record<string, string>>>>({});

  private cargando = new Set<Idioma>();

  constructor() {
    void this.init();
  }

  private async init(): Promise<void> {
    try {
      const lang = (localStorage.getItem(LS_KEY) as Idioma) || this.idiomaNavegador();
      if (lang !== 'es') await this.cargarCatalogo(lang);
      this._idioma.set(this.esValido(lang) ? lang : 'es');
    } catch {
      /* sin preferencia guardada → español */
    }
  }

  /** Idioma del navegador si es uno soportado; si no, español. */
  idiomaNavegador(): Idioma {
    const l = (navigator.language || 'es').slice(0, 2).toLowerCase();
    return this.esValido(l) ? l : 'es';
  }

  private esValido(l: string): l is Idioma {
    return l === 'es' || l === 'en' || l === 'ht';
  }

  /**
   * Traduce `esText` al idioma activo. Interpola `{clave}` con `params`. Si el
   * idioma es `es`, o no hay traducción para esa clave, devuelve el español.
   */
  t(esText: string, params?: Record<string, string | number>): string {
    const lang = this._idioma(); // ← lectura reactiva: re-render al cambiar idioma
    let out = esText;
    if (lang !== 'es') {
      const dict = this.catalogos()[lang];
      const tr = dict?.[esText];
      if (tr) out = tr;
    }
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        out = out.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
      }
    }
    return out;
  }

  /** Cambia el idioma (persistente local + servidor). Carga el catálogo la 1ª vez. */
  async setIdioma(lang: Idioma): Promise<void> {
    if (!this.esValido(lang)) return;
    if (lang !== 'es' && !this.catalogos()[lang]) await this.cargarCatalogo(lang);
    this._idioma.set(lang);
    try {
      localStorage.setItem(LS_KEY, lang);
    } catch {
      /* persistencia best-effort */
    }
    // BS4 — sincroniza el idioma en el servidor (usuarios.idioma) para que siga al
    // usuario entre dispositivos y a la app. Best-effort: si falla, ya quedó local.
    try {
      await this.supabase.client.rpc('mi_idioma_set', { p_idioma: lang });
    } catch {
      /* offline → solo local (degrada bien) */
    }
  }

  /** BS4 — adopta el idioma que trae el perfil del servidor (cross-device). NO
   *  re-escribe el servidor (evita bucle): solo aplica local + persiste. La llama
   *  UserService al cargar el perfil. */
  async adoptFromServer(lang: string | null | undefined): Promise<void> {
    if (!lang || !this.esValido(lang) || this._idioma() === lang) return;
    if (lang !== 'es' && !this.catalogos()[lang]) await this.cargarCatalogo(lang);
    this._idioma.set(lang);
    try {
      localStorage.setItem(LS_KEY, lang);
    } catch {
      /* best-effort */
    }
  }

  /** Carga `public/i18n/<lang>.json`. Best-effort: si falla, cae al español. */
  private async cargarCatalogo(lang: Idioma): Promise<void> {
    if (lang === 'es' || this.catalogos()[lang] || this.cargando.has(lang)) return;
    this.cargando.add(lang);
    try {
      const res = await fetch(`i18n/${lang}.json`, { cache: 'force-cache' });
      if (res.ok) {
        const dict = (await res.json()) as Record<string, string>;
        this.catalogos.update((c) => ({ ...c, [lang]: dict }));
      }
    } catch {
      /* offline sin caché → se queda en español */
    } finally {
      this.cargando.delete(lang);
    }
  }
}
