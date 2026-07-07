export type RutaEstado = 'planificada' | 'en_curso' | 'completada' | 'cancelada';

export interface Ruta {
  id: string;
  vehiculo_id: string;
  vehiculo?: { placa: string; marca: string; modelo: string };
  conductor_id: string | null;
  conductor?: { nombre: string };
  origen: string;
  destino: string;
  // Destination coordinates for the Intelligent Context System (weather at
  // destination). Resolved from the linked obra when set, else the explicit point.
  destino_lat: number | null;
  destino_lng: number | null;
  destino_proyecto_id: string | null;
  destino_proyecto?: { nombre: string; latitud: number | null; longitud: number | null };
  fecha: string;
  km_estimado: number | null;
  km_real: number | null;
  tiempo_estimado_min: number | null;
  tiempo_real_min: number | null;
  estado: RutaEstado;
  notas: string | null;
  creado_por: string | null;
  created_at: string;
  updated_at: string;
}

export interface RutaFormData {
  vehiculo_id: string;
  conductor_id: string | null;
  origen: string;
  destino: string;
  destino_lat: number | null;
  destino_lng: number | null;
  destino_proyecto_id: string | null;
  fecha: string;
  km_estimado: number | null;
  tiempo_estimado_min: number | null;
  estado: RutaEstado;
  notas: string | null;
}

/** Resolves the destination coordinates of a ruta: prefer the linked obra's
 *  coordinates, fall back to an explicitly picked point. Returns null if neither. */
export function destinoCoords(r: {
  destino_lat: number | null;
  destino_lng: number | null;
  destino_proyecto?: { latitud: number | null; longitud: number | null };
}): { latitud: number; longitud: number } | null {
  const pLat = r.destino_proyecto?.latitud;
  const pLng = r.destino_proyecto?.longitud;
  if (pLat != null && pLng != null) return { latitud: pLat, longitud: pLng };
  if (r.destino_lat != null && r.destino_lng != null) return { latitud: r.destino_lat, longitud: r.destino_lng };
  return null;
}

export const RUTA_ESTADOS: { value: RutaEstado; label: string; badge: string }[] = [
  { value: 'planificada', label: 'Planificada', badge: 'neutral' },
  { value: 'en_curso', label: 'En curso', badge: 'info' },
  { value: 'completada', label: 'Completada', badge: 'success' },
  { value: 'cancelada', label: 'Cancelada', badge: 'danger' },
];
