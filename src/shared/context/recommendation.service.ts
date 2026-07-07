import { Injectable } from '@angular/core';
import { Recomendacion, WeatherPronostico, interpretarCodigoTiempo } from './weather.model';

/** Pure, dependency-free construction recommendations derived from weather.
 *  Kept separate so the rules can grow (and later feed an AI assistant) without
 *  touching data-fetching code. */
@Injectable({ providedIn: 'root' })
export class RecommendationService {
  generar(p: WeatherPronostico): Recomendacion[] {
    const recs: Recomendacion[] = [];
    const a = p.actual;

    const lloviendo = (a.precipitacionMm ?? 0) > 0 || interpretarCodigoTiempo(a.codigoTiempo).lluvia;

    // Rain in the next 3 hours (high probability)?
    const proximas = p.porHora.slice(1, 4);
    const lluviaProxima = proximas.find((h) => (h.probPrecipitacion ?? 0) >= 60);

    if (lloviendo) {
      recs.push({
        nivel: 'peligro',
        icono: '🌧️',
        titulo: 'Lluvia en curso',
        detalle: 'Evita vaciado de concreto y protege materiales sensibles a la humedad.',
      });
    } else if (lluviaProxima) {
      recs.push({
        nivel: 'precaucion',
        icono: '🌦️',
        titulo: 'Lluvia próxima',
        detalle: `Alta probabilidad de lluvia en las próximas horas (${lluviaProxima.probPrecipitacion}%). Planifica el vaciado temprano.`,
      });
    }

    if ((a.vientoKmh ?? 0) >= 40) {
      recs.push({
        nivel: 'peligro',
        icono: '💨',
        titulo: 'Vientos fuertes',
        detalle: `Viento de ${Math.round(a.vientoKmh!)} km/h. Suspende grúas y trabajos en altura.`,
      });
    } else if ((a.vientoKmh ?? 0) >= 25) {
      recs.push({
        nivel: 'precaucion',
        icono: '💨',
        titulo: 'Viento moderado',
        detalle: 'Asegura andamios, mallas y materiales ligeros.',
      });
    }

    if ((a.uv ?? 0) >= 8) {
      recs.push({
        nivel: 'precaucion',
        icono: '☀️',
        titulo: 'Índice UV alto',
        detalle: 'Protección solar e hidratación para el personal expuesto.',
      });
    }

    const calor = a.sensacion ?? a.temperatura ?? 0;
    if (calor >= 35) {
      recs.push({
        nivel: 'precaucion',
        icono: '🥵',
        titulo: 'Calor extremo',
        detalle: `Sensación de ${Math.round(calor)}°C. Programa pausas e hidratación frecuente.`,
      });
    }

    if (recs.length === 0) {
      recs.push({
        nivel: 'info',
        icono: '✅',
        titulo: 'Condiciones favorables',
        detalle: 'No se detectan riesgos climáticos para las labores de obra.',
      });
    }
    return recs;
  }
}
