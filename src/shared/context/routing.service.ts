import { Injectable } from '@angular/core';

/** Resultado de una ruta calculada entre dos puntos. */
export interface RutaCalculada {
  distancia_km: number;
  duracion_min: number;
}

/**
 * Cálculo de distancia/tiempo de una ruta entre dos coordenadas.
 *
 * Proveedor independiente (igual que el clima/geocodificación): hoy usa OSRM
 * (keyless, OpenStreetMap). Para cambiar a Google Directions basta reescribir
 * SOLO este archivo y guardar la GOOGLE key — el contrato (origen+destino →
 * {distancia_km, duracion_min}) no cambia para los consumidores.
 */
@Injectable({ providedIn: 'root' })
export class RoutingService {
  private readonly base = 'https://router.project-osrm.org/route/v1/driving';

  /** Devuelve la distancia (km) y duración (min) manejando en auto, o null si falla. */
  async calcular(
    origenLat: number,
    origenLng: number,
    destinoLat: number,
    destinoLng: number,
  ): Promise<RutaCalculada | null> {
    try {
      const url = `${this.base}/${origenLng},${origenLat};${destinoLng},${destinoLat}?overview=false&alternatives=false`;
      const res = await fetch(url);
      if (!res.ok) return null;
      const data = (await res.json()) as { routes?: { distance: number; duration: number }[] };
      const r = data.routes?.[0];
      if (!r) return null;
      return {
        distancia_km: Math.round((r.distance / 1000) * 10) / 10,
        duracion_min: Math.round(r.duration / 60),
      };
    } catch {
      return null; // sin conexión / servicio caído → el usuario puede escribir a mano
    }
  }
}
