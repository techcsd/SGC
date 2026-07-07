import { InjectionToken } from '@angular/core';
import { Coordenadas } from './weather.model';
import { CalidadAire } from './air-quality.model';

/** Contract every air-quality provider must implement. Swap the implementation by
 *  re-binding the token; no consumer changes. Mirrors WeatherProvider. */
export interface AirQualityProvider {
  readonly nombre: string;
  getCalidadAire(coords: Coordenadas): Promise<CalidadAire>;
}

export const AIR_QUALITY_PROVIDER = new InjectionToken<AirQualityProvider>('AIR_QUALITY_PROVIDER');
