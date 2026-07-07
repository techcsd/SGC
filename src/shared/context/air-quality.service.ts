import { Injectable, inject } from '@angular/core';
import { AIR_QUALITY_PROVIDER } from './air-quality-provider';
import { Coordenadas } from './weather.model';
import { CalidadAire } from './air-quality.model';

const CACHE_TTL_MS = 30 * 60 * 1000; // same cadence as weather — air quality changes slowly

interface CacheEntry {
  at: number;
  data: CalidadAire;
}

/** Fetches air quality through the injected provider, with an in-memory TTL cache
 *  so the API isn't hit on every page load. Mirrors WeatherService. */
@Injectable({ providedIn: 'root' })
export class AirQualityService {
  private provider = inject(AIR_QUALITY_PROVIDER);
  private cache = new Map<string, CacheEntry>();

  private key(c: Coordenadas): string {
    return `${c.latitud.toFixed(3)},${c.longitud.toFixed(3)}`;
  }

  async getCalidadAire(coords: Coordenadas, opts: { force?: boolean } = {}): Promise<CalidadAire> {
    const key = this.key(coords);
    const hit = this.cache.get(key);
    if (!opts.force && hit && Date.now() - hit.at < CACHE_TTL_MS) {
      return hit.data;
    }
    const data = await this.provider.getCalidadAire(coords);
    this.cache.set(key, { at: Date.now(), data });
    return data;
  }

  get providerNombre(): string {
    return this.provider.nombre;
  }
}
