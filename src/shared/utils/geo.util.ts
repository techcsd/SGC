/** Par lat/lng simple — a propósito sin depender de `google.maps` para que estas
 *  funciones sean puras y testeables sin el SDK de Maps cargado. */
export interface LatLng {
  lat: number;
  lng: number;
}

/** F6 (ronda DF, DF4-A) — rumbo en grados (0=norte, sentido horario) entre dos coordenadas. */
export function rumboEntre(from: LatLng, to: LatLng): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const toDeg = (r: number) => (r * 180) / Math.PI;
  const y = Math.sin(toRad(to.lng - from.lng)) * Math.cos(toRad(to.lat));
  const x =
    Math.cos(toRad(from.lat)) * Math.sin(toRad(to.lat)) -
    Math.sin(toRad(from.lat)) * Math.cos(toRad(to.lat)) * Math.cos(toRad(to.lng - from.lng));
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** Distancia en metros entre dos coordenadas (haversine). */
export function distanciaMetros(from: LatLng, to: LatLng): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(to.lat - from.lat);
  const dLng = toRad(to.lng - from.lng);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(from.lat)) * Math.cos(toRad(to.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/**
 * F6b (ronda DF, DF4-C) — ETA en minutos a partir de la posición actual, un
 * destino real y una velocidad de referencia (nunca inventada: viene del
 * km_estimado/tiempo_estimado_min de la propia ruta). `null` si falta
 * cualquier dato — nunca un número sin sustento.
 */
export function etaMinutos(desde: LatLng, destino: LatLng | null | undefined, velocidadKmh: number | null | undefined): number | null {
  if (!destino || !velocidadKmh || velocidadKmh <= 0) return null;
  const metros = distanciaMetros(desde, destino);
  return Math.round((metros / 1000 / velocidadKmh) * 60);
}
