import { Injectable } from '@angular/core';
import { AirQualityProvider } from './air-quality-provider';
import { Coordenadas } from './weather.model';
import { CalidadAire } from './air-quality.model';

// Open-Meteo Air Quality — chosen for the same reasons as the weather provider:
// free, NO API key, CORS-enabled, and it exposes construction-relevant fields
// (PM2.5/PM10 particulates, dust, ozone) plus US/European AQI. Re-bind
// AIR_QUALITY_PROVIDER to switch providers; nothing else changes.
const BASE = 'https://air-quality-api.open-meteo.com/v1/air-quality';

interface AQResponse {
  current?: Record<string, number> & { time?: string };
}

@Injectable({ providedIn: 'root' })
export class OpenMeteoAirProvider implements AirQualityProvider {
  readonly nombre = 'Open-Meteo Air Quality';

  async getCalidadAire(coords: Coordenadas): Promise<CalidadAire> {
    const params = new URLSearchParams({
      latitude: String(coords.latitud),
      longitude: String(coords.longitud),
      current: 'pm10,pm2_5,us_aqi,european_aqi,ozone,nitrogen_dioxide,sulphur_dioxide,carbon_monoxide,dust',
      timezone: 'auto',
    });
    const res = await fetch(`${BASE}?${params.toString()}`);
    if (!res.ok) throw new Error(`Open-Meteo Air Quality respondió ${res.status}`);
    const data = (await res.json()) as AQResponse;
    const c = data.current ?? {};
    return {
      capturadoEn: c.time ?? new Date().toISOString(),
      usAqi: c['us_aqi'] ?? null,
      europeanAqi: c['european_aqi'] ?? null,
      pm25: c['pm2_5'] ?? null,
      pm10: c['pm10'] ?? null,
      ozono: c['ozone'] ?? null,
      no2: c['nitrogen_dioxide'] ?? null,
      so2: c['sulphur_dioxide'] ?? null,
      co: c['carbon_monoxide'] ?? null,
      polvo: c['dust'] ?? null,
    };
  }
}
