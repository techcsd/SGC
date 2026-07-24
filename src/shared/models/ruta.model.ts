export type RutaEstado = 'planificada' | 'en_curso' | 'completada' | 'cancelada';

export interface Ruta {
  id: string;
  vehiculo_id: string;
  vehiculo?: { placa: string; marca: string; modelo: string };
  conductor_id: string | null;
  conductor?: { nombre: string };
  origen: string;
  destino: string;
  // Origin coordinates — feed the auto route estimate (distance/time via OSRM).
  origen_lat?: number | null;
  origen_lng?: number | null;
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
  // Y4 — instante real del TAP (offline-first): inicio y fin de la ruta.
  // Duración real = finalizada_at − iniciada_at (ver duracionRealMin()).
  iniciada_at?: string | null;
  finalizada_at?: string | null;
  // T2 — dato de prueba (solo admin lo ve/gestiona; oculto por RLS a no-admin).
  es_prueba?: boolean;
  created_at: string;
  updated_at: string;
}

export interface RutaFormData {
  vehiculo_id: string;
  conductor_id: string | null;
  origen: string;
  destino: string;
  origen_lat?: number | null;
  origen_lng?: number | null;
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

/** Y4 — Duración real en minutos desde los timestamps del TAP (fin − inicio).
 *  null si falta alguno (ruta gestionada solo desde la web sin TAP). */
export function duracionRealMin(r: {
  iniciada_at?: string | null;
  finalizada_at?: string | null;
}): number | null {
  if (!r.iniciada_at || !r.finalizada_at) return null;
  const ini = new Date(r.iniciada_at).getTime();
  const fin = new Date(r.finalizada_at).getTime();
  if (!isFinite(ini) || !isFinite(fin) || fin < ini) return null;
  return Math.round((fin - ini) / 60000);
}

export const RUTA_ESTADOS: { value: RutaEstado; label: string; badge: string }[] = [
  { value: 'planificada', label: 'Planificada', badge: 'neutral' },
  { value: 'en_curso', label: 'En curso', badge: 'info' },
  { value: 'completada', label: 'Completada', badge: 'success' },
  { value: 'cancelada', label: 'Cancelada', badge: 'danger' },
];
