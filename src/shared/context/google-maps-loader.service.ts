import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';

// AO1 — Carga el SDK de Google Maps JS UNA sola vez. La key de NAVEGADOR (restringida
// por HTTP referrer / package+SHA-1, solo "Maps JavaScript API") se obtiene por la RPC
// sgc.maps_api_key() → NUNCA está hardcodeada en el repo (lección AG1). Si la key no
// está configurada, load() rechaza y cada componente muestra su fallback (mapa
// deshabilitado con mensaje claro), sin romper la página.
//
// Se cargan SOLO las librerías base (sin `places`): la búsqueda de lugares va por la
// edge function places-search (key de servidor), así la key de navegador se limita al
// mínimo. Marcadores clásicos (google.maps.Marker) → no requieren Map ID en la consola.

@Injectable({ providedIn: 'root' })
export class GoogleMapsLoader {
  private supabase = inject(SupabaseService);
  private loadPromise: Promise<typeof google.maps> | null = null;
  private keyPromise: Promise<string | null> | null = null;

  private async getKey(): Promise<string | null> {
    if (!this.keyPromise) {
      this.keyPromise = (async () => {
        try {
          const { data, error } = await this.supabase.client.rpc('maps_api_key');
          return error ? null : ((data as string | null) || null);
        } catch {
          return null;
        }
      })();
    }
    return this.keyPromise;
  }

  /** Resuelve con `google.maps` listo, o rechaza si la key no está configurada / falló la carga. */
  load(): Promise<typeof google.maps> {
    if (this.loadPromise) return this.loadPromise;
    this.loadPromise = (async () => {
      if (typeof google !== 'undefined' && google.maps) return google.maps;

      const key = await this.getKey();
      if (!key) {
        this.loadPromise = null; // permite reintentar si la key se configura luego
        throw new Error('Mapa no disponible: falta configurar la API key de Google Maps.');
      }

      await new Promise<void>((resolve, reject) => {
        const w = window as unknown as Record<string, unknown>;
        const cb = '__sgcGmapsReady';
        w[cb] = () => resolve();
        const s = document.createElement('script');
        s.src =
          'https://maps.googleapis.com/maps/api/js' +
          `?key=${encodeURIComponent(key)}&language=es&region=DO&loading=async&callback=${cb}`;
        s.async = true;
        s.onerror = () => {
          this.loadPromise = null;
          reject(new Error('No se pudo cargar Google Maps.'));
        };
        document.head.appendChild(s);
      });

      return google.maps;
    })();
    return this.loadPromise;
  }
}
