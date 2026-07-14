import { Injectable } from '@angular/core';
import { Coordenadas } from './weather.model';

export interface LugarBusqueda {
  nombre: string;
  latitud: number;
  longitud: number;
}

// Uses OpenStreetMap Nominatim (keyless) for reverse/forward geocoding, matching
// the keyless Leaflet map. Provider-independent shape so it can be swapped for a
// paid geocoder later without touching callers.
const NOMINATIM = 'https://nominatim.openstreetmap.org';

@Injectable({ providedIn: 'root' })
export class GeocodingService {
  /** Coordinates → human-readable address. */
  async reverse(coords: Coordenadas): Promise<string> {
    const params = new URLSearchParams({
      lat: String(coords.latitud),
      lon: String(coords.longitud),
      format: 'json',
      'accept-language': 'es',
    });
    try {
      const res = await fetch(`${NOMINATIM}/reverse?${params.toString()}`);
      if (!res.ok) return '';
      const data = (await res.json()) as { display_name?: string };
      return data.display_name ?? '';
    } catch {
      return '';
    }
  }

  /**
   * Address/place search → candidate locations (bias RD). U19: propaga errores
   * (throttle 429 / red) para que el UI distinga "sin resultados" de "fallo";
   * acepta AbortSignal para cancelar búsquedas obsoletas (debounce en el UI).
   */
  async buscar(texto: string, signal?: AbortSignal): Promise<LugarBusqueda[]> {
    if (!texto.trim()) return [];
    const params = new URLSearchParams({
      q: texto,
      format: 'json',
      'accept-language': 'es',
      countrycodes: 'do',
      limit: '6',
      dedupe: '1',
    });
    const res = await fetch(`${NOMINATIM}/search?${params.toString()}`, { signal });
    if (!res.ok) throw new Error(`El buscador de mapas respondió ${res.status}`);
    const data = (await res.json()) as { display_name: string; lat: string; lon: string }[];
    return data.map((d) => ({ nombre: d.display_name, latitud: Number(d.lat), longitud: Number(d.lon) }));
  }
}
