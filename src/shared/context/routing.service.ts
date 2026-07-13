import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';

/** Resultado de una ruta calculada entre dos puntos. */
export interface RutaCalculada {
  distancia_km: number;
  duracion_min: number;
}

/**
 * Cálculo de distancia/tiempo de una ruta entre dos coordenadas.
 *
 * Proveedor independiente: usa **Google Directions** vía la edge function
 * `routing-directions` (la API key vive como secreto del servidor, nunca en el
 * frontend) y cae a **OSRM** (keyless) si Google falla o no hay ruta. El
 * contrato (origen+destino → {distancia_km, duracion_min}) no cambia para los
 * consumidores.
 */
@Injectable({ providedIn: 'root' })
export class RoutingService {
  private supabase = inject(SupabaseService);
  private readonly osrm = 'https://router.project-osrm.org/route/v1/driving';

  /** Devuelve la distancia (km) y duración (min) manejando en auto, o null si falla. */
  async calcular(
    origenLat: number,
    origenLng: number,
    destinoLat: number,
    destinoLng: number,
  ): Promise<RutaCalculada | null> {
    // 1) Google Directions (server-side, key protegida)
    try {
      const { data } = await this.supabase.client.functions.invoke('routing-directions', {
        body: { origen_lat: origenLat, origen_lng: origenLng, destino_lat: destinoLat, destino_lng: destinoLng },
      });
      const g = data as { distancia_km?: number; duracion_min?: number } | null;
      if (g && typeof g.distancia_km === 'number' && typeof g.duracion_min === 'number') {
        return { distancia_km: g.distancia_km, duracion_min: g.duracion_min };
      }
    } catch {
      /* cae a OSRM */
    }

    // 2) Fallback keyless OSRM
    try {
      const url = `${this.osrm}/${origenLng},${origenLat};${destinoLng},${destinoLat}?overview=false&alternatives=false`;
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
      return null; // sin conexión → el usuario puede escribir a mano
    }
  }
}
