import { Injectable } from '@angular/core';
import { Recomendacion, WeatherPronostico, interpretarCodigoTiempo } from './weather.model';
import { CalidadAire } from './air-quality.model';

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

    return recs;
  }

  /** Fallback advisory when no weather or air risk is detected. */
  favorable(): Recomendacion {
    return {
      nivel: 'info',
      icono: '✅',
      titulo: 'Condiciones favorables',
      detalle: 'No se detectan riesgos climáticos ni de calidad del aire para las labores de obra.',
    };
  }

  /** Air-quality advisories (particulates/dust are the construction concern). Kept
   *  separate so callers can include them only when air data is available. */
  generarAire(a: CalidadAire): Recomendacion[] {
    const recs: Recomendacion[] = [];
    const aqi = a.usAqi ?? 0;

    if (aqi > 200) {
      recs.push({
        nivel: 'peligro',
        icono: '😷',
        titulo: 'Aire muy dañino',
        detalle: `Índice de calidad del aire ${Math.round(aqi)}. Limita el trabajo prolongado al aire libre y usa protección respiratoria.`,
      });
    } else if (aqi > 150) {
      recs.push({
        nivel: 'precaucion',
        icono: '😷',
        titulo: 'Aire dañino',
        detalle: `Índice de calidad del aire ${Math.round(aqi)}. Personal sensible con protección respiratoria; vigila esfuerzos prolongados.`,
      });
    }

    // Dust/particulates on-site even when overall AQI is moderate.
    if ((a.polvo ?? 0) >= 150 || (a.pm10 ?? 0) >= 150) {
      recs.push({
        nivel: 'precaucion',
        icono: '🌫️',
        titulo: 'Polvo/partículas elevadas',
        detalle: 'Riego para abatir polvo y mascarillas para trabajos de corte, demolición o movimiento de tierra.',
      });
    }
    return recs;
  }
}
