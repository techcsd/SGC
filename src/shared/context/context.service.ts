import { Injectable, inject } from '@angular/core';
import { WeatherService } from './weather.service';
import { AirQualityService } from './air-quality.service';
import { RecommendationService } from './recommendation.service';
import { GeocodingService } from './geocoding.service';
import { Coordenadas, Recomendacion, WeatherPronostico } from './weather.model';
import { CalidadAire } from './air-quality.model';

export interface ContextoObra {
  coords: Coordenadas;
  direccion?: string;
  pronostico: WeatherPronostico;
  /** Air quality at the location (null if the source failed — weather still returns). */
  aire: CalidadAire | null;
  recomendaciones: Recomendacion[];
}

/** Facade for the Intelligent Context System. Modules ask the ContextService
 *  for real-world context around a location instead of calling weather/maps
 *  providers directly — so new context sources (traffic, air quality, alerts)
 *  can be added here without changing every consumer. */
@Injectable({ providedIn: 'root' })
export class ContextService {
  private weather = inject(WeatherService);
  private airQuality = inject(AirQualityService);
  private recommendations = inject(RecommendationService);
  private geocoding = inject(GeocodingService);

  async getContexto(coords: Coordenadas, opts: { force?: boolean } = {}): Promise<ContextoObra> {
    // Sources are independent → fetch in parallel. Air quality is best-effort: a
    // failure there must not blank the weather (the primary context).
    const [pronostico, aire] = await Promise.all([
      this.weather.getPronostico(coords, opts),
      this.airQuality.getCalidadAire(coords, opts).catch(() => null),
    ]);

    const recomendaciones = [
      ...this.recommendations.generar(pronostico),
      ...(aire ? this.recommendations.generarAire(aire) : []),
    ];
    if (recomendaciones.length === 0) recomendaciones.push(this.recommendations.favorable());

    return { coords, pronostico, aire, recomendaciones };
  }

  reverseGeocode(coords: Coordenadas): Promise<string> {
    return this.geocoding.reverse(coords);
  }
}
