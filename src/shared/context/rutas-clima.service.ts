import { Injectable, inject } from '@angular/core';
import { ContextService } from './context.service';
import { Coordenadas, RiesgoNivel, WeatherDia, interpretarCodigoTiempo } from './weather.model';

export interface RutaClima {
  /** Forecast for the trip day, if the date is within the 7-day forecast window. */
  dia: WeatherDia | null;
  /** Dispatch advisory derived from the trip-day forecast (null = favorable/unknown). */
  recomendacion: { nivel: RiesgoNivel; titulo: string; detalle: string } | null;
}

/** Weather-at-destination for transport (Flota). Given a destination and the trip
 *  date, returns that day's forecast + a dispatch recommendation ("lluvia en destino,
 *  despacha temprano"). Reuses ContextService so the same provider/cache backs it. */
@Injectable({ providedIn: 'root' })
export class RutasClimaService {
  private context = inject(ContextService);

  async getClimaDestino(coords: Coordenadas, fechaIso: string): Promise<RutaClima> {
    const { pronostico } = await this.context.getContexto(coords);
    const dia = pronostico.porDia.find((d) => d.fecha === fechaIso) ?? null;
    return { dia, recomendacion: dia ? this.recomendar(dia) : null };
  }

  /** Batch: resolve trip-day weather for several rutas at once (best-effort). */
  async getClimaRutas(
    rutas: { id: string; coords: Coordenadas; fecha: string }[],
  ): Promise<Map<string, RutaClima>> {
    const out = new Map<string, RutaClima>();
    await Promise.all(
      rutas.map(async (r) => {
        try {
          out.set(r.id, await this.getClimaDestino(r.coords, r.fecha));
        } catch {
          /* skip: a failed forecast shouldn't blank the whole list */
        }
      }),
    );
    return out;
  }

  private recomendar(d: WeatherDia): RutaClima['recomendacion'] {
    const tormenta = (d.codigoTiempo ?? 0) >= 95;
    const prob = d.probPrecipitacionMax ?? 0;
    const lluvia = prob >= 60 || interpretarCodigoTiempo(d.codigoTiempo).lluvia;
    const viento = d.vientoMaxKmh ?? 0;

    if (tormenta) {
      return {
        nivel: 'peligro',
        titulo: 'Tormenta en el destino',
        detalle: 'Se esperan tormentas el día del viaje. Evalúa posponer el despacho o reforzar la protección de la carga.',
      };
    }
    if (viento >= 40) {
      return {
        nivel: 'peligro',
        titulo: 'Viento fuerte en el destino',
        detalle: `Viento de hasta ${Math.round(viento)} km/h. Precaución con carga voluminosa o descubierta.`,
      };
    }
    if (lluvia) {
      return {
        nivel: 'precaucion',
        titulo: 'Lluvia probable en el destino',
        detalle: `${prob}% de probabilidad de lluvia. Considera despachar temprano y proteger la carga; prevé más tiempo de viaje.`,
      };
    }
    return null;
  }
}
