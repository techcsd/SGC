import { Injectable } from '@angular/core';
import { WeatherProvider } from './weather-provider';
import { Coordenadas, WeatherActual, WeatherDia, WeatherHora, WeatherPronostico } from './weather.model';

// Open-Meteo was chosen as the weather provider because:
//  • Free with NO API key and no billing — nothing blocks on secrets, safe in a
//    fully client-side app.
//  • CORS-enabled, so it can be called directly from the browser.
//  • Construction-relevant fields (precipitation probability, wind, UV, gusts).
//  • Hourly + 7-day forecast, stable and well-documented.
// If a paid provider is ever preferred, implement WeatherProvider elsewhere and
// re-bind WEATHER_PROVIDER — nothing else changes.
const BASE = 'https://api.open-meteo.com/v1/forecast';

interface OMResponse {
  current?: Record<string, number> & { time?: string };
  hourly?: { time: string[]; [k: string]: (number | null)[] | string[] };
  daily?: { time: string[]; [k: string]: (number | null)[] | string[] };
}

@Injectable({ providedIn: 'root' })
export class OpenMeteoProvider implements WeatherProvider {
  readonly nombre = 'Open-Meteo';

  async getPronostico(coords: Coordenadas): Promise<WeatherPronostico> {
    const params = new URLSearchParams({
      latitude: String(coords.latitud),
      longitude: String(coords.longitud),
      current:
        'temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,cloud_cover,wind_speed_10m,wind_direction_10m',
      hourly: 'temperature_2m,precipitation_probability,precipitation,weather_code,uv_index,visibility',
      daily:
        'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,wind_speed_10m_max,uv_index_max',
      timezone: 'auto',
      forecast_days: '7',
    });

    const res = await fetch(`${BASE}?${params.toString()}`);
    if (!res.ok) throw new Error(`Open-Meteo respondió ${res.status}`);
    const data = (await res.json()) as OMResponse;

    return {
      actual: this.mapActual(data),
      porHora: this.mapHoras(data),
      porDia: this.mapDias(data),
    };
  }

  private mapActual(data: OMResponse): WeatherActual {
    const c = data.current ?? {};
    // Current-hour extras (UV, visibility, precip probability) come from the
    // hourly arrays at the index matching current.time.
    const hourly = data.hourly;
    let idx = 0;
    if (hourly?.time && c.time) {
      const found = hourly.time.indexOf(c.time.slice(0, 13) + ':00');
      idx = found >= 0 ? found : hourly.time.findIndex((t) => t >= (c.time ?? ''));
      if (idx < 0) idx = 0;
    }
    const h = (key: string): number | null => {
      const arr = hourly?.[key] as (number | null)[] | undefined;
      return arr ? (arr[idx] ?? null) : null;
    };
    const vis = h('visibility');
    return {
      capturadoEn: c.time ?? new Date().toISOString(),
      temperatura: c['temperature_2m'] ?? null,
      sensacion: c['apparent_temperature'] ?? null,
      humedad: c['relative_humidity_2m'] ?? null,
      vientoKmh: c['wind_speed_10m'] ?? null,
      vientoDir: c['wind_direction_10m'] ?? null,
      precipitacionMm: c['precipitation'] ?? null,
      probPrecipitacion: h('precipitation_probability'),
      nubosidad: c['cloud_cover'] ?? null,
      uv: h('uv_index'),
      visibilidadKm: vis != null ? Math.round(vis / 100) / 10 : null,
      codigoTiempo: c['weather_code'] ?? null,
      crudo: data.current,
    };
  }

  private mapHoras(data: OMResponse): WeatherHora[] {
    const hourly = data.hourly;
    if (!hourly?.time) return [];
    const temp = hourly['temperature_2m'] as (number | null)[];
    const prob = hourly['precipitation_probability'] as (number | null)[];
    const code = hourly['weather_code'] as (number | null)[];
    // Next 24 hours.
    return hourly.time.slice(0, 24).map((hora, i) => ({
      hora,
      temperatura: temp?.[i] ?? null,
      probPrecipitacion: prob?.[i] ?? null,
      codigoTiempo: code?.[i] ?? null,
    }));
  }

  private mapDias(data: OMResponse): WeatherDia[] {
    const daily = data.daily;
    if (!daily?.time) return [];
    const num = (key: string, i: number): number | null => {
      const arr = daily[key] as (number | null)[] | undefined;
      return arr ? (arr[i] ?? null) : null;
    };
    return daily.time.map((fecha, i) => ({
      fecha,
      tempMax: num('temperature_2m_max', i),
      tempMin: num('temperature_2m_min', i),
      probPrecipitacionMax: num('precipitation_probability_max', i),
      precipitacionMm: num('precipitation_sum', i),
      vientoMaxKmh: num('wind_speed_10m_max', i),
      uvMax: num('uv_index_max', i),
      codigoTiempo: num('weather_code', i),
    }));
  }
}
