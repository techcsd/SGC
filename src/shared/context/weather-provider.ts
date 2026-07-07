import { InjectionToken } from '@angular/core';
import { Coordenadas, WeatherPronostico } from './weather.model';

/** Contract every weather provider must implement. Swap the implementation
 *  (Open-Meteo → OpenWeather/Tomorrow.io/…) by re-binding the token; no module
 *  that consumes weather changes. */
export interface WeatherProvider {
  readonly nombre: string;
  getPronostico(coords: Coordenadas): Promise<WeatherPronostico>;
}

export const WEATHER_PROVIDER = new InjectionToken<WeatherProvider>('WEATHER_PROVIDER');
