import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';
import { WEATHER_PROVIDER } from './weather-provider';
import { Coordenadas, WeatherActual, WeatherPronostico } from './weather.model';

const CACHE_TTL_MS = 30 * 60 * 1000; // don't refetch a location's weather more than every 30 min

interface CacheEntry {
  at: number;
  data: WeatherPronostico;
}

/** Fetches weather through the injected provider, with an in-memory TTL cache so
 *  the API isn't hit on every page load, and persists snapshots (for a project)
 *  so future BI can query weather history. */
@Injectable({ providedIn: 'root' })
export class WeatherService {
  private provider = inject(WEATHER_PROVIDER);
  private supabase = inject(SupabaseService);
  private cache = new Map<string, CacheEntry>();

  private key(c: Coordenadas): string {
    return `${c.latitud.toFixed(3)},${c.longitud.toFixed(3)}`;
  }

  async getPronostico(coords: Coordenadas, opts: { force?: boolean } = {}): Promise<WeatherPronostico> {
    const key = this.key(coords);
    const hit = this.cache.get(key);
    // Date.now() is available in the browser runtime (this is app code, not a workflow script).
    if (!opts.force && hit && Date.now() - hit.at < CACHE_TTL_MS) {
      return hit.data;
    }
    const data = await this.provider.getPronostico(coords);
    this.cache.set(key, { at: Date.now(), data });
    return data;
  }

  /** Persists a current-conditions snapshot (optionally tied to a project) and
   *  returns its id — used to auto-attach weather to a bitácora. */
  async guardarSnapshot(coords: Coordenadas, actual: WeatherActual, proyectoId: string | null): Promise<string | null> {
    const { data, error } = await this.supabase.client
      .from('weather_snapshots')
      .insert({
        proyecto_id: proyectoId,
        latitud: coords.latitud,
        longitud: coords.longitud,
        capturado_en: actual.capturadoEn,
        temperatura: actual.temperatura,
        sensacion: actual.sensacion,
        humedad: actual.humedad,
        viento_kmh: actual.vientoKmh,
        viento_dir: actual.vientoDir,
        precipitacion_mm: actual.precipitacionMm,
        prob_precipitacion: actual.probPrecipitacion,
        nubosidad: actual.nubosidad,
        uv: actual.uv,
        visibilidad_km: actual.visibilidadKm,
        codigo_tiempo: actual.codigoTiempo,
        crudo: actual.crudo ?? null,
      })
      .select('id')
      .single();

    if (error) {
      console.error('WeatherService.guardarSnapshot:', error.message);
      return null;
    }
    return (data as { id: string }).id;
  }

  get providerNombre(): string {
    return this.provider.nombre;
  }
}
