import { Injectable, inject } from '@angular/core';
import { WeatherService } from './weather.service';
import { RecommendationService } from './recommendation.service';
import { GeocodingService } from './geocoding.service';
import { Coordenadas, Recomendacion, WeatherPronostico } from './weather.model';

export interface ContextoObra {
  coords: Coordenadas;
  direccion?: string;
  pronostico: WeatherPronostico;
  recomendaciones: Recomendacion[];
}

/** Facade for the Intelligent Context System. Modules ask the ContextService
 *  for real-world context around a location instead of calling weather/maps
 *  providers directly — so new context sources (traffic, air quality, alerts)
 *  can be added here without changing every consumer. */
@Injectable({ providedIn: 'root' })
export class ContextService {
  private weather = inject(WeatherService);
  private recommendations = inject(RecommendationService);
  private geocoding = inject(GeocodingService);

  async getContexto(coords: Coordenadas, opts: { force?: boolean } = {}): Promise<ContextoObra> {
    const pronostico = await this.weather.getPronostico(coords, opts);
    return {
      coords,
      pronostico,
      recomendaciones: this.recommendations.generar(pronostico),
    };
  }

  reverseGeocode(coords: Coordenadas): Promise<string> {
    return this.geocoding.reverse(coords);
  }
}
