import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';

// AO2 — Cliente de la edge function places-search (Google Places API New v1, key de
// SERVIDOR). Cualquier lugar registrado en Google aparece; al elegir devuelve coords +
// nombre + dirección. Sesgo a RD lo aplica el servidor (regionCode "do").

export interface PlacePrediction {
  placeId: string;
  primary: string;   // nombre principal
  secondary: string; // dirección secundaria
  description: string;
}

export interface PlaceResult {
  name: string;
  lat: number;
  lng: number;
  address: string;
}

@Injectable({ providedIn: 'root' })
export class PlacesService {
  private supabase = inject(SupabaseService);

  // Token de sesión: agrupa autocomplete+details en una sesión de facturación de Google.
  private sessionToken: string | null = null;

  /** Inicia una sesión de búsqueda (llamar al abrir el buscador). */
  nuevaSesion() {
    this.sessionToken =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : String(Date.now());
  }

  async autocomplete(input: string, signal?: AbortSignal): Promise<PlacePrediction[]> {
    if (!this.sessionToken) this.nuevaSesion();
    const { data, error } = await this.invoke(
      { action: 'autocomplete', input, sessionToken: this.sessionToken },
      signal,
    );
    if (error) throw new Error(error);
    return (data?.predictions ?? []) as PlacePrediction[];
  }

  /** Resuelve una sugerencia a coordenadas. Cierra la sesión de facturación. */
  async details(placeId: string): Promise<PlaceResult | null> {
    const token = this.sessionToken;
    this.sessionToken = null; // details cierra la sesión
    const { data, error } = await this.invoke({ action: 'details', placeId, sessionToken: token });
    if (error || !data || typeof data.lat !== 'number') return null;
    return { name: data.name ?? '', lat: data.lat, lng: data.lng, address: data.address ?? '' };
  }

  /** Búsqueda por texto (una llamada, coords directas) — fallback sin autocompletar. */
  async text(input: string, near?: { lat: number; lng: number }): Promise<PlaceResult[]> {
    const { data, error } = await this.invoke({ action: 'text', input, ...(near ?? {}) });
    if (error) throw new Error(error);
    return (data?.results ?? []) as PlaceResult[];
  }

  private async invoke(body: Record<string, unknown>, signal?: AbortSignal) {
    try {
      const { data, error } = await this.supabase.client.functions.invoke('places-search', { body });
      if (signal?.aborted) return { data: null, error: 'aborted' as string | null };
      if (error) return { data: null, error: error.message ?? 'Error de búsqueda' };
      if (data?.error) return { data, error: data.error as string };
      return { data, error: null as string | null };
    } catch (e) {
      if (signal?.aborted) return { data: null, error: 'aborted' as string | null };
      return { data: null, error: String(e) };
    }
  }
}
